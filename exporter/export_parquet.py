"""
Export the hourly air-quality time series from Postgres to Hive-partitioned Parquet.

Layout written under --out (default $PARQUET_DIR or ./parquet_out):

    v1/measurements/year=YYYY/month=MM/data.parquet   one file per month, sorted by
                                                     (station_id, parameter_name, collected_at)
    v1/stations.parquet                              one row per station, with lat/lon
    v1/parameters.parquet                            one row per parameter
    v1/_manifest.json                                what is published, when, row counts

The same tree is uploaded to R2 (bucket $R2_BUCKET) under the same keys when --upload is set.

Sources (auto-detected schema):
    --source postgres://user:pass@host:5432/db
        * "timescale" schema: readings(time, station_id, parameter, value, unit) + stations(...)
          (the maintainers' TimescaleDB). Timestamps there are stored as
          timestamptz whose UTC rendering equals the source's IST wall-clock, so we read them AT TIME ZONE 'UTC'.
        * "dashboard" schema: air_quality_data(station_id, station_name, state_name, city_name,
          parameter_name, unit, collected_at, value) (the Hetzner dashboard database).
    --source duckdb:/path/to/file.duckdb   testing; a DuckDB file with either table.

Published station ids are `site_NNNN` for CPCB and `DS10100NN` for the US embassy monitors.

Month selection (pick one):
    --months 2024-01 2024-02      explicit
    --since 2024-01               that month through the current month
    --recent N                    last N months including the current one (default: 2)
    --full                        every month present in the source

Examples:
    python -m exporter.export_parquet --full --upload            # first run
    python -m exporter.export_parquet --recent 2 --upload        # after each sync
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable

import duckdb
from dotenv import load_dotenv

logger = logging.getLogger("exporter")

SCHEMA_VERSION = "v1"
ROW_GROUP_SIZE = 1_000_000
REPO_ROOT = Path(__file__).resolve().parent.parent

EMBASSY_PREFIX = "DS101"
EMBASSY_STATIONS = {  # id -> (name, city, state, lat, lon)
    "DS1010001": ("US Embassy - New Delhi", "New Delhi", "Delhi", 28.635760, 77.224450),
    "DS1010002": ("US Embassy - Chennai", "Chennai", "Tamil Nadu", 13.087840, 80.278475),
    "DS1010003": ("US Embassy - Kolkata", "Kolkata", "West Bengal", 22.562630, 88.363040),
    "DS1010004": ("US Embassy - Mumbai", "Mumbai", "Maharashtra", 19.072830, 72.882610),
    "DS1010005": ("US Embassy - Hyderabad", "Hyderabad", "Telangana", 17.384050, 78.456360),
}

UNIT_SQL = "CASE upper(trim({u})) WHEN 'UG/M3' THEN 'µg/m³' WHEN 'MG/M3' THEN 'mg/m³' ELSE trim({u}) END"


@dataclass
class MonthResult:
    year: int
    month: int
    rows: int
    bytes: int
    key: str


# ---------------------------------------------------------------------------
# Source handling
# ---------------------------------------------------------------------------
class Source:
    """DuckDB connection with the source attached as `src`, plus a `station_dim` temp table.

    `month_sql(start, end)` returns a DuckDB query producing the canonical columns
    (station_id, station_name, state_name, city_name, parameter_name, unit, collected_at, value, source).
    """

    def __init__(self, source_url: str, threads: int, memory_limit: str, temp_dir: str | None):
        self.con = duckdb.connect()
        self.con.execute(f"SET threads = {int(threads)}")
        self.con.execute(f"SET memory_limit = '{memory_limit}'")
        self.con.execute("SET preserve_insertion_order = false")
        if temp_dir:
            Path(temp_dir).mkdir(parents=True, exist_ok=True)
            self.con.execute(f"SET temp_directory = '{temp_dir}'")

        self.is_pg = source_url.startswith(("postgres://", "postgresql://"))
        if source_url.startswith("duckdb:"):
            self.con.execute(f"ATTACH '{source_url[len('duckdb:'):]}' AS src (READ_ONLY)")
            tables = {r[0] for r in self.con.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_catalog = 'src'").fetchall()}
        elif self.is_pg:
            self.con.execute("INSTALL postgres; LOAD postgres;")
            self.con.execute(f"ATTACH '{source_url}' AS src (TYPE postgres, READ_ONLY)")
            tables = {r[0] for r in self.con.execute(
                "SELECT table_name FROM postgres_query('src', "
                "'SELECT table_name FROM information_schema.tables WHERE table_schema = ''public''')").fetchall()}
        else:
            raise SystemExit(f"Unsupported --source {source_url!r}; use postgres://... or duckdb:/path")

        if "readings" in tables:
            self.schema = "timescale"
        elif "air_quality_data" in tables:
            self.schema = "dashboard"
        else:
            raise SystemExit(f"Source has neither `readings` nor `air_quality_data` (tables: {sorted(tables)})")
        logger.info("Source schema: %s", self.schema)

    # -- running SQL on the source ------------------------------------------------
    def _remote(self, pg_sql: str) -> str:
        """A DuckDB relation that runs `pg_sql` on the source (server-side for Postgres)."""
        if self.is_pg:
            return f"postgres_query('src', $pg${pg_sql}$pg$)"
        return f"({pg_sql.replace(' readings', ' src.main.readings').replace(' stations', ' src.main.stations').replace(' air_quality_data', ' src.main.air_quality_data')})"

    def month_bounds(self) -> tuple[date, date] | None:
        if self.schema == "timescale":
            sql = "SELECT min(time) AT TIME ZONE 'UTC' AS lo, max(time) AT TIME ZONE 'UTC' AS hi FROM readings" if self.is_pg \
                else "SELECT min(time) AS lo, max(time) AS hi FROM readings"
        else:
            sql = "SELECT min(collected_at) AS lo, max(collected_at) AS hi FROM air_quality_data"
        row = self.con.execute(f"SELECT lo, hi FROM {self._remote(sql)}").fetchone()
        if not row or row[0] is None:
            return None
        return row[0].date().replace(day=1), row[1].date().replace(day=1)

    # -- station dimension -------------------------------------------------------------
    def build_station_dim(self, locations_csvs: list[Path]) -> None:
        """station_dim(raw_id, station_id, station_name, state_name, city_name, latitude, longitude, source)."""
        con = self.con
        if self.schema == "timescale":
            raw = self._remote(
                "SELECT r.station_id AS raw_id, s.station_name, s.state, s.city, s.latitude, s.longitude "
                "FROM (SELECT DISTINCT station_id FROM readings) r LEFT JOIN stations s ON s.station_id = r.station_id")
            con.execute(f"""
                CREATE OR REPLACE TEMP TABLE _raw_stations AS
                SELECT raw_id,
                       CASE WHEN regexp_matches(raw_id, '^site_[0-9]+_') THEN regexp_extract(raw_id, '^(site_[0-9]+)_', 1) ELSE raw_id END AS station_id,
                       CASE WHEN station_name IS NOT NULL AND station_name <> raw_id THEN station_name
                            ELSE regexp_replace(raw_id, '^site_[0-9]+_', '') END AS station_name,
                       NOT (station_name IS NOT NULL AND station_name <> raw_id) AS name_derived,
                       state AS state_name, city AS city_name, latitude, longitude
                FROM {raw}""")
        else:
            raw = self._remote(
                "SELECT station_id, max(station_name) AS station_name, max(state_name) AS state_name, max(city_name) AS city_name "
                "FROM air_quality_data GROUP BY station_id")
            con.execute(f"""
                CREATE OR REPLACE TEMP TABLE _raw_stations AS
                SELECT station_id AS raw_id, station_id, station_name, false AS name_derived, state_name, city_name,
                       NULL::DOUBLE AS latitude, NULL::DOUBLE AS longitude
                FROM {raw}""")

        # Candidate locations from the repo CSVs, matchable by exact full name or by a normalised short name
        # ("Mahakaleshwar Temple, Ujjain - MPPCB" -> "mahakaleshwartempleujjain").
        con.execute("CREATE OR REPLACE TEMP TABLE _loc (full_name VARCHAR, norm VARCHAR, state VARCHAR, city VARCHAR, latitude DOUBLE, longitude DOUBLE)")
        for p in locations_csvs:
            if not p.exists():
                logger.warning("locations CSV not found: %s", p)
                continue
            rows = []
            with p.open(newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    try:
                        name = r["station"].strip()
                        rows.append((name, _norm(name), (r.get("state") or "").replace("_", " ").strip() or None,
                                     (r.get("city") or "").strip() or None, float(r["latitude"]), float(r["longitude"])))
                    except (KeyError, ValueError):
                        continue
            con.executemany("INSERT INTO _loc VALUES (?, ?, ?, ?, ?, ?)", rows)
            logger.info("loaded %d location rows from %s", len(rows), p.name)
        con.execute("CREATE OR REPLACE TEMP TABLE _loc1 AS SELECT * FROM _loc QUALIFY row_number() OVER (PARTITION BY norm ORDER BY full_name) = 1")

        con.execute("CREATE OR REPLACE TEMP TABLE _emb (station_id VARCHAR, station_name VARCHAR, city VARCHAR, state VARCHAR, latitude DOUBLE, longitude DOUBLE)")
        con.executemany("INSERT INTO _emb VALUES (?, ?, ?, ?, ?, ?)", [(k, *v) for k, v in EMBASSY_STATIONS.items()])

        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE station_dim AS
            WITH s AS (
                SELECT r.*,
                       regexp_replace(lower(regexp_replace(r.station_name, ' - [^-]*$', '')), '[^a-z0-9]', '', 'g') AS norm
                FROM _raw_stations r
            )
            SELECT s.raw_id, s.station_id,
                   coalesce(e.station_name,
                            CASE WHEN s.name_derived THEN coalesce(lx.full_name, ln.full_name) END,
                            s.station_name)                                          AS station_name,
                   coalesce(e.state, s.state_name, lx.state, ln.state)            AS state_name,
                   coalesce(e.city, s.city_name, lx.city, ln.city)                AS city_name,
                   coalesce(e.latitude, s.latitude, lx.latitude, ln.latitude)     AS latitude,
                   coalesce(e.longitude, s.longitude, lx.longitude, ln.longitude) AS longitude,
                   CASE WHEN s.station_id LIKE '{EMBASSY_PREFIX}%' THEN 'us_embassy' ELSE 'cpcb_caaqm' END AS source
            FROM s
            LEFT JOIN _emb  e  ON e.station_id = s.station_id
            LEFT JOIN _loc1 lx ON lx.full_name = s.station_name
            LEFT JOIN _loc1 ln ON ln.norm = s.norm AND lx.full_name IS NULL
        """)
        n, missing, dup = con.execute(
            "SELECT count(*), count(*) FILTER (WHERE latitude IS NULL), count(*) - count(DISTINCT station_id) FROM station_dim").fetchone()
        logger.info("station_dim: %d stations, %d without coordinates, %d duplicate public ids", n, missing, dup)
        if dup:
            dups = con.execute("SELECT station_id, list(raw_id) FROM station_dim GROUP BY 1 HAVING count(*) > 1 LIMIT 5").fetchall()
            raise SystemExit(f"Public station ids are not unique: {dups}")

    # -- monthly slice ---------------------------------------------------------------------
    def month_sql(self, start: date, end: date) -> str:
        if self.schema == "timescale":
            if self.is_pg:
                raw = self._remote(
                    f"SELECT station_id AS raw_id, parameter, unit, (time AT TIME ZONE 'UTC') AS collected_at, value "
                    f"FROM readings WHERE time >= TIMESTAMPTZ '{start.isoformat()} 00:00:00+00' "
                    f"AND time < TIMESTAMPTZ '{end.isoformat()} 00:00:00+00' AND value IS NOT NULL")
            else:
                raw = self._remote(
                    f"SELECT station_id AS raw_id, parameter, unit, time AS collected_at, value "
                    f"FROM readings WHERE time >= TIMESTAMP '{start.isoformat()} 00:00:00' "
                    f"AND time < TIMESTAMP '{end.isoformat()} 00:00:00' AND value IS NOT NULL")
            return f"""
                SELECT d.station_id, d.station_name, d.state_name, d.city_name,
                       replace(r.parameter, ' ', '_') AS parameter_name,
                       {UNIT_SQL.format(u='r.unit')} AS unit,
                       r.collected_at::TIMESTAMP AS collected_at, r.value::DOUBLE AS value, d.source
                FROM {raw} r JOIN station_dim d ON d.raw_id = r.raw_id"""
        raw = self._remote(
            f"SELECT station_id AS raw_id, parameter_name, unit, collected_at, value FROM air_quality_data "
            f"WHERE collected_at >= TIMESTAMP '{start.isoformat()} 00:00:00' "
            f"AND collected_at < TIMESTAMP '{end.isoformat()} 00:00:00' AND value IS NOT NULL")
        return f"""
            SELECT d.station_id, d.station_name, d.state_name, d.city_name,
                   r.parameter_name, {UNIT_SQL.format(u='r.unit')} AS unit,
                   r.collected_at::TIMESTAMP AS collected_at, r.value::DOUBLE AS value, d.source
            FROM {raw} r JOIN station_dim d ON d.raw_id = r.raw_id"""


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r" - [^-]*$", "", name).lower())


# ---------------------------------------------------------------------------
# Month selection
# ---------------------------------------------------------------------------
def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def _parse_ym(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m").date().replace(day=1)
    except ValueError:
        raise SystemExit(f"Bad month {s!r}; expected YYYY-MM")


def _months_between(start: date, end: date) -> list[date]:
    out, cur = [], start
    while cur <= end:
        out.append(cur)
        cur = _add_months(cur, 1)
    return out


def select_months(args, src: Source) -> list[date]:
    today = date.today().replace(day=1)
    if args.months:
        return sorted({_parse_ym(m) for m in args.months})
    if args.since:
        return _months_between(_parse_ym(args.since), today)
    if args.full:
        bounds = src.month_bounds()
        if not bounds:
            logger.warning("Source table is empty; nothing to export.")
            return []
        return _months_between(bounds[0], max(bounds[1], today))
    n = max(1, int(args.recent))
    return _months_between(_add_months(today, -(n - 1)), today)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------
def measurements_dir(out: Path) -> Path:
    return out / SCHEMA_VERSION / "measurements"


def month_path(out: Path, ym: date) -> Path:
    return measurements_dir(out) / f"year={ym.year}" / f"month={ym.month:02d}" / "data.parquet"


def rel_key(out: Path, p: Path) -> str:
    return p.relative_to(out).as_posix()


def export_month(src: Source, out: Path, ym: date) -> MonthResult | None:
    start, end = ym, _add_months(ym, 1)
    dest = month_path(out, ym)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".parquet.tmp")

    t0 = time.time()
    src.con.execute(
        f"COPY ({src.month_sql(start, end)} ORDER BY station_id, parameter_name, collected_at) "
        f"TO '{tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE {ROW_GROUP_SIZE})"
    )
    rows = src.con.execute(f"SELECT count(*) FROM read_parquet('{tmp.as_posix()}')").fetchone()[0]
    if rows == 0:
        tmp.unlink(missing_ok=True)
        if dest.exists():
            logger.info("%s-%02d now empty; removing stale %s", ym.year, ym.month, dest)
            dest.unlink()
            try:
                dest.parent.rmdir()
            except OSError:
                pass
        return None
    os.replace(tmp, dest)  # atomic on the same filesystem
    size = dest.stat().st_size
    logger.info("%s-%02d: %s rows, %.1f MB, %.1fs", ym.year, ym.month, f"{rows:,}", size / 1e6, time.time() - t0)
    return MonthResult(ym.year, ym.month, rows, size, rel_key(out, dest))


def build_dimensions(src: Source, out: Path) -> tuple[int, int]:
    """stations.parquet (station_dim + per-station stats) and parameters.parquet, from the exported files."""
    con = src.con
    files = list(measurements_dir(out).glob("year=*/month=*/data.parquet"))
    if not files:
        logger.warning("No measurement files under %s; skipping dimension tables", out)
        return 0, 0
    glob = (measurements_dir(out) / "*" / "*" / "data.parquet").as_posix()
    rp = f"read_parquet('{glob}', hive_partitioning = true, hive_types = {{'year': INTEGER, 'month': INTEGER}})"

    stations_tmp = out / SCHEMA_VERSION / "stations.parquet.tmp"
    con.execute(f"""
        COPY (
            WITH per_sp AS (  -- aggregate per (station, parameter) first; a list() over every row would not fit in memory
                SELECT station_id, parameter_name,
                       arg_max(station_name, collected_at) AS station_name,
                       arg_max(state_name, collected_at)   AS state_name,
                       arg_max(city_name, collected_at)    AS city_name,
                       any_value(source)                   AS source,
                       min(collected_at) AS first_seen, max(collected_at) AS last_seen,
                       count(*)::BIGINT  AS n_rows
                FROM {rp} GROUP BY station_id, parameter_name
            ),
            stats AS (
                SELECT station_id,
                       arg_max(station_name, last_seen) AS station_name,
                       arg_max(state_name, last_seen)   AS state_name,
                       arg_max(city_name, last_seen)    AS city_name,
                       any_value(source)                AS source,
                       min(first_seen) AS first_seen, max(last_seen) AS last_seen,
                       sum(n_rows)::BIGINT AS n_rows,
                       list_sort(list(parameter_name)) AS parameters
                FROM per_sp GROUP BY station_id
            ),
            dim AS (SELECT station_id, any_value(latitude) AS latitude, any_value(longitude) AS longitude FROM station_dim GROUP BY station_id)
            SELECT s.station_id, s.station_name, s.state_name, s.city_name, s.source,
                   d.latitude, d.longitude, s.first_seen, s.last_seen, s.n_rows, s.parameters
            FROM stats s LEFT JOIN dim d USING (station_id)
            ORDER BY s.source, s.state_name, s.city_name, s.station_name
        ) TO '{stations_tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    os.replace(stations_tmp, stations_tmp.with_suffix(""))

    params_tmp = out / SCHEMA_VERSION / "parameters.parquet.tmp"
    con.execute(f"""
        COPY (
            SELECT parameter_name, arg_max(unit, cnt) AS unit,
                   count(DISTINCT station_id) AS n_stations, sum(cnt)::BIGINT AS n_rows,
                   min(first_seen) AS first_seen, max(last_seen) AS last_seen
            FROM (
                SELECT parameter_name, unit, station_id, count(*) AS cnt,
                       min(collected_at) AS first_seen, max(collected_at) AS last_seen
                FROM {rp} GROUP BY parameter_name, unit, station_id
            )
            GROUP BY parameter_name ORDER BY n_rows DESC
        ) TO '{params_tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    os.replace(params_tmp, params_tmp.with_suffix(""))

    sp = (out / SCHEMA_VERSION / "stations.parquet").as_posix()
    n_st, missing = con.execute(f"SELECT count(*), count(*) FILTER (WHERE latitude IS NULL) FROM '{sp}'").fetchone()
    n_pa = con.execute(f"SELECT count(*) FROM '{(out / SCHEMA_VERSION / 'parameters.parquet').as_posix()}'").fetchone()[0]
    logger.info("stations.parquet: %d stations (%d without coordinates); parameters.parquet: %d parameters", n_st, missing, n_pa)
    return n_st, n_pa


def write_manifest(con: duckdb.DuckDBPyConnection, out: Path, n_stations: int, n_parameters: int) -> dict:
    """Describe every month file currently on disk (not just the ones touched this run)."""
    months = []
    for p in sorted(measurements_dir(out).glob("year=*/month=*/data.parquet")):
        y = int(p.parent.parent.name.split("=")[1])
        m = int(p.parent.name.split("=")[1])
        rows = con.execute(f"SELECT count(*) FROM read_parquet('{p.as_posix()}')").fetchone()[0]
        months.append({"year": y, "month": m, "rows": rows, "bytes": p.stat().st_size, "key": rel_key(out, p)})
    root = out / SCHEMA_VERSION
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone_note": "collected_at is a naive timestamp in Indian Standard Time (UTC+05:30).",
        "columns": {
            "station_id": "VARCHAR", "station_name": "VARCHAR", "state_name": "VARCHAR", "city_name": "VARCHAR",
            "parameter_name": "VARCHAR", "unit": "VARCHAR", "collected_at": "TIMESTAMP",
            "value": "DOUBLE", "source": "VARCHAR ('cpcb_caaqm' | 'us_embassy')",
            "year": "hive partition", "month": "hive partition",
        },
        "measurements": {"rows": sum(m["rows"] for m in months), "bytes": sum(m["bytes"] for m in months), "months": months},
        "stations": {"rows": n_stations, "key": f"{SCHEMA_VERSION}/stations.parquet",
                     "bytes": (root / "stations.parquet").stat().st_size if (root / "stations.parquet").exists() else 0},
        "parameters": {"rows": n_parameters, "key": f"{SCHEMA_VERSION}/parameters.parquet",
                       "bytes": (root / "parameters.parquet").stat().st_size if (root / "parameters.parquet").exists() else 0},
    }
    path = root / "_manifest.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2))
    os.replace(tmp, path)
    return manifest


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def r2_client():
    import boto3
    from botocore.config import Config

    endpoint = os.environ.get("CLOUDFLARE_S3")
    key_id = os.environ.get("CLOUDFLARE_ACCESS_ID")
    secret = os.environ.get("CLOUDFLARE_SECRET")
    if not (endpoint and key_id and secret):
        raise SystemExit("Upload needs CLOUDFLARE_S3, CLOUDFLARE_ACCESS_ID and CLOUDFLARE_SECRET in the environment")
    return boto3.client(
        "s3", endpoint_url=endpoint, aws_access_key_id=key_id, aws_secret_access_key=secret, region_name="auto",
        config=Config(signature_version="s3v4",
                      # R2 rejects the newer boto3 default trailing checksums.
                      request_checksum_calculation="when_required", response_checksum_validation="when_required"),
    )


def upload_files(out: Path, keys: Iterable[str], bucket: str) -> None:
    s3 = r2_client()
    content_types = {".parquet": "application/vnd.apache.parquet", ".json": "application/json"}
    for key in keys:
        local = out / key
        ctype = content_types.get(local.suffix, "application/octet-stream")
        t0 = time.time()
        for attempt in range(3):
            try:
                s3.upload_file(str(local), bucket, key, ExtraArgs={"ContentType": ctype})
                break
            except Exception:
                if attempt == 2:
                    raise
                logger.warning("upload of %s failed (attempt %d); retrying", key, attempt + 1)
                time.sleep(2 ** attempt)
        logger.info("uploaded s3://%s/%s (%.1f MB, %.1fs)", bucket, key, local.stat().st_size / 1e6, time.time() - t0)


def delete_keys(keys: Iterable[str], bucket: str) -> None:
    keys = list(keys)
    if not keys:
        return
    s3 = r2_client()
    s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys]})
    for k in keys:
        logger.info("deleted s3://%s/%s", bucket, k)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run_once(args) -> dict:
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    src = Source(args.source, threads=args.threads, memory_limit=args.memory_limit, temp_dir=args.temp_dir)
    src.build_station_dim([Path(p) for p in args.locations_csv])

    months = [] if args.dimensions_only else select_months(args, src)
    logger.info("Exporting %d month(s): %s", len(months),
                ", ".join(f"{m.year}-{m.month:02d}" for m in months) or "(none)")

    bucket = args.bucket or os.environ.get("R2_BUCKET")
    if args.upload and not bucket:
        raise SystemExit("--upload needs --bucket or R2_BUCKET")

    touched: list[str] = []
    removed: list[str] = []
    for ym in months:
        existed = month_path(out, ym).exists()
        res = export_month(src, out, ym)
        if res:
            touched.append(res.key)
            if args.upload:
                upload_files(out, [res.key], bucket)  # upload as we go so a long full run is resumable
        elif existed:
            removed.append(rel_key(out, month_path(out, ym)))

    n_st, n_pa = build_dimensions(src, out)
    manifest = write_manifest(src.con, out, n_st, n_pa)
    dims = [f"{SCHEMA_VERSION}/stations.parquet", f"{SCHEMA_VERSION}/parameters.parquet", f"{SCHEMA_VERSION}/_manifest.json"]
    if args.upload:
        upload_files(out, dims, bucket)
        delete_keys(removed, bucket)
    else:
        logger.info("Upload skipped (--no-upload). %d file(s) written under %s", len(touched) + len(dims), out)

    src.con.close()
    return manifest


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", default=os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL"),
                   help="postgres://... or duckdb:/path (default: $POSTGRES_URL)")
    p.add_argument("--out", default=os.environ.get("PARQUET_DIR", "parquet_out"),
                   help="local output root (default: $PARQUET_DIR or ./parquet_out)")
    sel = p.add_mutually_exclusive_group()
    sel.add_argument("--months", nargs="+", metavar="YYYY-MM")
    sel.add_argument("--since", metavar="YYYY-MM")
    sel.add_argument("--recent", type=int, default=int(os.environ.get("EXPORT_RECENT_MONTHS", "2")),
                     help="last N months incl. current (default 2)")
    sel.add_argument("--full", action="store_true")
    sel.add_argument("--dimensions-only", action="store_true",
                     help="skip month export; rebuild stations/parameters/manifest from the files on disk")
    up = p.add_mutually_exclusive_group()
    up.add_argument("--upload", dest="upload", action="store_true", help="upload touched files to R2")
    up.add_argument("--no-upload", dest="upload", action="store_false")
    p.set_defaults(upload=os.environ.get("EXPORT_UPLOAD", "0") == "1")
    p.add_argument("--bucket", default=os.environ.get("R2_BUCKET"))
    p.add_argument("--locations-csv", nargs="*", default=[
        os.environ.get("STATION_LOCATIONS_CSV", str(REPO_ROOT / "stations" / "station_locations.csv")),
        str(REPO_ROOT / "stations" / "station_locations_11feb2026.csv")],
        help="CSV(s) with station,state,city,latitude,longitude used to fill missing coordinates")
    p.add_argument("--threads", type=int, default=int(os.environ.get("EXPORT_THREADS", "4")))
    p.add_argument("--memory-limit", default=os.environ.get("EXPORT_MEMORY_LIMIT", "4GB"))
    p.add_argument("--temp-dir", default=os.environ.get("EXPORT_TEMP_DIR"))
    p.add_argument("--loop", type=int, metavar="SECONDS", default=int(os.environ.get("EXPORT_INTERVAL_SECONDS", "0")),
                   help="run forever, sleeping this long between runs (0 = run once)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv=None) -> int:
    load_dotenv(REPO_ROOT / ".env")
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not args.source:
        build_parser().error("--source (or POSTGRES_URL) is required")

    while True:
        t0 = time.time()
        try:
            manifest = run_once(args)
            logger.info("Export done in %.0fs: %s rows across %d months, %d stations",
                        time.time() - t0, f"{manifest['measurements']['rows']:,}",
                        len(manifest["measurements"]["months"]), manifest["stations"]["rows"])
        except Exception:
            logger.exception("Export failed")
            if not args.loop:
                return 1
        if not args.loop:
            return 0
        logger.info("Sleeping %ds", args.loop)
        time.sleep(args.loop)


if __name__ == "__main__":
    sys.exit(main())
