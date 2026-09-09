"""DuckDB access to the Parquet tree (local directory or R2/S3), with per-query timeouts."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import duckdb

from . import config

logger = logging.getLogger("api.db")


class QueryTimeout(Exception):
    pass


class NoData(Exception):
    pass


def lit(s: str) -> str:
    """SQL string literal. DuckDB standard strings have no escapes other than the doubled quote."""
    return "'" + str(s).replace("'", "''") + "'"


class Data:
    def __init__(self, root: str):
        self.root = root.rstrip("/")
        self.remote = config.IS_REMOTE
        self.con = duckdb.connect()
        self.con.execute(f"SET threads = {config.DUCKDB_THREADS}")
        self.con.execute(f"SET memory_limit = '{config.DUCKDB_MEMORY_LIMIT}'")
        self.con.execute("SET enable_progress_bar = false")
        if self.remote:
            self._configure_remote()
        self._manifest: dict | None = None
        self._manifest_stamp: float = 0.0  # local: mtime; remote: time of last read

    def _configure_remote(self) -> None:
        self.con.execute("INSTALL httpfs; LOAD httpfs;")
        endpoint = os.environ.get("CLOUDFLARE_S3", "")
        key_id = os.environ.get("CLOUDFLARE_ACCESS_ID", "")
        secret = os.environ.get("CLOUDFLARE_SECRET", "")
        if not (endpoint and key_id and secret):
            raise SystemExit("PARQUET_DIR is remote; set CLOUDFLARE_S3, CLOUDFLARE_ACCESS_ID and CLOUDFLARE_SECRET")
        host = endpoint.replace("https://", "").replace("http://", "").rstrip("/")
        self.con.execute(f"""
            CREATE OR REPLACE SECRET r2 (
                TYPE s3, PROVIDER config,
                KEY_ID {lit(key_id)}, SECRET {lit(secret)},
                ENDPOINT {lit(host)}, REGION 'auto', URL_STYLE 'path', USE_SSL true
            )""")
        # Keep Parquet footers and recently read byte ranges in memory across queries.
        for setting in ("SET parquet_metadata_cache = true", "SET enable_external_file_cache = true"):
            try:
                self.con.execute(setting)
            except duckdb.Error:
                pass
        logger.info("Reading Parquet from %s via %s", self.root, host)

    # -- manifest ----------------------------------------------------------
    def manifest(self) -> dict:
        path = f"{self.root}/_manifest.json"
        if self.remote:
            now = time.time()
            if self._manifest is None or now - self._manifest_stamp > config.MANIFEST_TTL_SECONDS:
                try:
                    (content,) = self.con.execute(f"SELECT content FROM read_text({lit(path)})").fetchone()
                except duckdb.Error as e:
                    if self._manifest is not None:
                        return self._manifest  # serve the stale copy rather than fail
                    raise NoData("No data has been exported yet.") from e
                self._manifest = json.loads(content)
                self._manifest_stamp = now
            return self._manifest
        try:
            mtime = Path(path).stat().st_mtime
        except FileNotFoundError:
            raise NoData("No data has been exported yet.")
        if self._manifest is None or mtime != self._manifest_stamp:
            self._manifest = json.loads(Path(path).read_text())
            self._manifest_stamp = mtime
        return self._manifest

    def stations_path(self) -> str:
        return f"{self.root}/stations.parquet"

    def parameters_path(self) -> str:
        return f"{self.root}/parameters.parquet"

    def measurements(self, start: date, end: date) -> str:
        """A read_parquet(...) source expression restricted to the month partitions covering [start, end].

        The file list comes from the manifest, so only the needed month files are opened (no
        directory listing, which matters for object storage).
        """
        files = [m["key"] for m in self.manifest()["measurements"]["months"]
                 if (m["year"], m["month"]) >= (start.year, start.month) and (m["year"], m["month"]) <= (end.year, end.month)]
        if not files:
            return "(SELECT * FROM (VALUES (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)) " \
                   "t(station_id, station_name, state_name, city_name, parameter_name, unit, collected_at, value, source) WHERE false)"
        base = self.root[: -len("/" + config.SCHEMA_VERSION)]
        paths = ", ".join(lit(f"{base}/{k}") for k in files)
        return f"(SELECT * FROM read_parquet([{paths}], hive_partitioning = true, hive_types = {{'year': INTEGER, 'month': INTEGER}}))"

    # -- execution ---------------------------------------------------------
    async def run(self, statements: list[str], fetch: str | None = None, timeout: float | None = None) -> Any:
        """Run statements on a fresh cursor in a worker thread, interrupting on timeout.

        `fetch` is the final SELECT whose rows are returned (columns, rows). Statements before it
        (temp tables, COPY) run for their side effects.
        """
        timeout = timeout or config.QUERY_TIMEOUT_SECONDS
        cur = self.con.cursor()

        def work():
            try:
                for stmt in statements:
                    cur.execute(stmt)
                if fetch:
                    res = cur.execute(fetch)
                    cols = [d[0] for d in res.description]
                    return cols, res.fetchall()
                return None
            finally:
                cur.close()

        loop = asyncio.get_running_loop()
        fut = loop.run_in_executor(None, work)
        t0 = time.time()
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout)
        except asyncio.TimeoutError:
            logger.warning("query timed out after %.1fs; interrupting", time.time() - t0)
            try:
                cur.interrupt()
            except Exception:
                pass
            fut.add_done_callback(lambda f: f.exception())  # swallow the InterruptException from the worker thread
            raise QueryTimeout(f"Query exceeded {timeout:.0f}s. Narrow the time range or use the bulk files.")
