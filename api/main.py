"""
Public query API for the AQI dataset. Runs behind the Cloudflare Worker gateway, which handles
API keys and rate limits and forwards the caller's key id and tier as headers.

Routes (all under /v1 except /health):
  GET /health
  GET /v1/meta                what is published: export time, months, row counts, schema
  GET /v1/files               bulk Parquet files (download them through the gateway at /v1/files/<key>)
  GET /v1/stations            station dimension, filterable
  GET /v1/parameters          parameter dimension
  GET /v1/measurements        the time series, filterable, optionally aggregated; json | csv | parquet
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from . import config
from .auth import Caller, gateway
from .db import Data, NoData, QueryTimeout, lit

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("api")

if not config.DEV_MODE and not config.GATEWAY_SECRET:
    raise SystemExit("GATEWAY_SECRET is not set. Set it (same value as the Worker's ORIGIN_SECRET) or API_DEV_MODE=1 for local dev.")
if config.DEV_MODE:
    logger.warning("API_DEV_MODE=1: gateway secret is NOT enforced. Do not run like this in production.")

app = FastAPI(
    title="India Air Quality API",
    version="1.0",
    description="Hourly pollutant time series from CPCB CAAQM stations and US Embassy/Consulate monitors in India. "
                "By XKDR Forum. Get a key at /signup; send it as `Authorization: Bearer aqi_...`.",
    docs_url="/v1/docs", redoc_url=None, openapi_url="/v1/openapi.json",
    swagger_ui_parameters={"defaultModelsExpandDepth": -1, "persistAuthorization": True, "tryItOutEnabled": True},
)
data = Data(config.DATA_ROOT)


def _openapi():
    """Advertise bearer-key auth so the Swagger console's Authorize button sends the key through the gateway."""
    if app.openapi_schema:
        return app.openapi_schema
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    schema.setdefault("components", {}).setdefault("securitySchemes", {})["ApiKey"] = {
        "type": "http", "scheme": "bearer", "bearerFormat": "aqi_...", "description": "Your API key from /signup"}
    schema["security"] = [{"ApiKey": []}]
    for path, ops in schema.get("paths", {}).items():
        for op in ops.values():
            # the gateway headers are internal; hide them from the public docs
            op["parameters"] = [q for q in op.get("parameters", []) if not q["name"].startswith("x-")]
    app.openapi_schema = schema
    return schema


app.openapi = _openapi

Format = Literal["json", "csv", "parquet"]
Agg = Literal["raw", "hourly", "daily", "monthly"]
Source = Literal["cpcb_caaqm", "us_embassy"]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
@app.exception_handler(NoData)
async def _no_data(_: Request, exc: NoData):
    return JSONResponse(status_code=503, content={"error": "no_data", "detail": str(exc)})


@app.exception_handler(QueryTimeout)
async def _timeout(_: Request, exc: QueryTimeout):
    return JSONResponse(status_code=504, content={"error": "query_timeout", "detail": str(exc)})


@app.exception_handler(HTTPException)
async def _http(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": "request_error", "detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, exc: RequestValidationError):
    problems = [f"{'.'.join(str(x) for x in e.get('loc', [])[1:])}: {e.get('msg')}" for e in exc.errors()]
    return JSONResponse(status_code=400, content={"error": "invalid_parameter", "detail": "; ".join(problems)})


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"error": "internal_error", "detail": "Internal Server Error"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _rows_to_dicts(cols, rows):
    return [{c: _jsonable(v) for c, v in zip(cols, r)} for r in rows]


UNLIMITED = 10**12  # effectively no cap; a LIMIT keeps the SQL uniform


async def _respond(request: Request, caller: Caller, select_sql: str, fmt: Format, cap: int | None, meta: dict, filename: str):
    """Materialise `select_sql` (capped at cap+1 rows to detect truncation) and return it in `fmt`.

    cap None = unlimited (full/admin tiers): no row cap, no JSON cap, longer timeout.
    """
    t0 = time.time()
    unlimited = cap is None
    if unlimited:
        cap = UNLIMITED
    elif fmt == "json":
        cap = min(cap, config.JSON_MAX_ROWS)
    stmts = [f"CREATE TEMP TABLE _r AS {select_sql} LIMIT {cap + 1}"]
    headers = {"X-Key-Id": caller.key_id, "X-Tier": caller.tier}

    if fmt == "json":
        cols, rows = await data.run(stmts, fetch="SELECT * FROM _r", timeout=caller.timeout)
        truncated = len(rows) > cap
        rows = rows[:cap]
        meta.update({"rows": len(rows), "truncated": truncated, "max_rows": None if unlimited else cap,
                     "query_ms": int((time.time() - t0) * 1000)})
        if truncated:
            meta["hint"] = "Result was cut at max_rows. Narrow the query, aggregate, use csv/parquet, or download the bulk files at /v1/files."
        headers.update({"X-Row-Count": str(len(rows)), "X-Truncated": str(truncated).lower()})
        return JSONResponse({"meta": meta, "data": _rows_to_dicts(cols, rows)}, headers=headers)

    fd, path = tempfile.mkstemp(suffix=f".{fmt}", prefix="aqi_")
    os.close(fd)
    if fmt == "csv":
        copy = f"COPY (SELECT * FROM _r LIMIT {cap}) TO '{path}' (FORMAT CSV, HEADER)"
        media = "text/csv"
    else:
        copy = f"COPY (SELECT * FROM _r LIMIT {cap}) TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        media = "application/vnd.apache.parquet"
    try:
        (_, [(n,)]) = await data.run(stmts + [copy], fetch="SELECT count(*) FROM _r", timeout=caller.timeout)
    except Exception:
        os.unlink(path)
        raise
    truncated = n > cap
    headers.update({"X-Row-Count": str(min(n, cap)), "X-Truncated": str(truncated).lower(),
                    "X-Query-Ms": str(int((time.time() - t0) * 1000))})
    return FileResponse(path, media_type=media, filename=f"{filename}.{fmt}", headers=headers,
                        background=BackgroundTask(os.unlink, path))


def _parse_day(s: str | None, name: str) -> date | None:
    if s is None:
        return None
    for fmt_ in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt_).date()
        except ValueError:
            continue
    raise HTTPException(400, f"{name} must be YYYY-MM-DD")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    try:
        m = data.manifest()
        return {"status": "ok", "exported_at": m["exported_at"], "rows": m["measurements"]["rows"]}
    except NoData:
        return JSONResponse(status_code=503, content={"status": "no_data"})


@app.get("/v1/meta")
async def meta(caller: Caller = Depends(gateway)):
    m = data.manifest()
    months = m["measurements"]["months"]
    return {
        "schema_version": m["schema_version"],
        "exported_at": m["exported_at"],
        "timezone_note": m["timezone_note"],
        "columns": m["columns"],
        "measurements": {
            "rows": m["measurements"]["rows"], "bytes": m["measurements"]["bytes"], "n_months": len(months),
            "first_month": f"{months[0]['year']}-{months[0]['month']:02d}" if months else None,
            "last_month": f"{months[-1]['year']}-{months[-1]['month']:02d}" if months else None,
        },
        "stations": m["stations"]["rows"],
        "parameters": m["parameters"]["rows"],
        "your_tier": caller.tier,
        "max_rows_per_query": caller.max_rows,  # null = unlimited
        "query_timeout_seconds": caller.timeout,
    }


@app.get("/v1/files")
async def files(caller: Caller = Depends(gateway)):
    m = data.manifest()
    items = [{"key": m["stations"]["key"], "kind": "stations", "bytes": m["stations"].get("bytes")},
             {"key": m["parameters"]["key"], "kind": "parameters", "bytes": m["parameters"].get("bytes")}]
    items += [{"key": mo["key"], "kind": "measurements", "year": mo["year"], "month": mo["month"],
               "rows": mo["rows"], "bytes": mo["bytes"]} for mo in m["measurements"]["months"]]
    return {"exported_at": m["exported_at"], "download": "GET /v1/files/<key> with your API key",
            "duckdb_hint": "SELECT * FROM read_parquet('v1/measurements/*/*/data.parquet', hive_partitioning=true)",
            "files": items}


@app.get("/v1/stations")
async def stations(
    request: Request,
    source: Source | None = None,
    state: str | None = None,
    city: str | None = None,
    q: str | None = Query(None, description="case-insensitive substring of the station name"),
    format: Format = "json",
    caller: Caller = Depends(gateway),
):
    data.manifest()
    where = ["true"]
    if source:
        where.append(f"source = {lit(source)}")
    if state:
        where.append(f"lower(state_name) = lower({lit(state)})")
    if city:
        where.append(f"lower(city_name) = lower({lit(city)})")
    if q:
        where.append(f"station_name ILIKE {lit('%' + q + '%')}")
    sql = f"SELECT * FROM '{data.stations_path()}' WHERE {' AND '.join(where)}"
    return await _respond(request, caller, sql, format, cap=100_000, meta={"filters": {"source": source, "state": state, "city": city, "q": q}}, filename="stations")


@app.get("/v1/parameters")
async def parameters(request: Request, format: Format = "json", caller: Caller = Depends(gateway)):
    data.manifest()
    return await _respond(request, caller, f"SELECT * FROM '{data.parameters_path()}'", format, cap=10_000, meta={}, filename="parameters")


@app.get("/v1/measurements")
async def measurements(
    request: Request,
    station: list[str] | None = Query(None, description="station_id; repeatable"),
    parameter: list[str] | None = Query(None, description="parameter_name, e.g. PM2.5; repeatable"),
    state: str | None = None,
    city: str | None = None,
    source: Source | None = None,
    start: str | None = Query(None, description="YYYY-MM-DD inclusive (IST). Default: end - 30 days"),
    end: str | None = Query(None, description="YYYY-MM-DD inclusive (IST). Default: today"),
    agg: Agg = "raw",
    format: Format = "json",
    limit: int | None = Query(None, ge=1, description="row cap; defaults to your tier's maximum"),
    caller: Caller = Depends(gateway),
):
    data.manifest()
    end_d = _parse_day(end, "end") or date.today()
    start_d = _parse_day(start, "start") or (end_d - timedelta(days=config.DEFAULT_WINDOW_DAYS))
    if start_d > end_d:
        raise HTTPException(400, "start must be on or before end")

    where = [f"collected_at >= TIMESTAMP {lit(start_d.isoformat() + ' 00:00:00')}",
             f"collected_at <  TIMESTAMP {lit((end_d + timedelta(days=1)).isoformat() + ' 00:00:00')}"]
    if station:
        where.append("station_id IN (" + ", ".join(lit(s) for s in station) + ")")
    if parameter:
        where.append("parameter_name IN (" + ", ".join(lit(p) for p in parameter) + ")")
    if state:
        where.append(f"lower(state_name) = lower({lit(state)})")
    if city:
        where.append(f"lower(city_name) = lower({lit(city)})")
    if source:
        where.append(f"source = {lit(source)}")
    src = data.measurements(start_d, end_d)
    cond = " AND ".join(where)

    if agg == "raw":
        sql = (f"SELECT station_id, parameter_name, unit, collected_at, value FROM {src} AS m "
               f"WHERE {cond} ORDER BY station_id, parameter_name, collected_at")
    else:
        unit_ = {"hourly": "hour", "daily": "day", "monthly": "month"}[agg]
        sql = (f"SELECT station_id, parameter_name, unit, date_trunc('{unit_}', collected_at) AS period_start, "
               f"avg(value) AS mean, min(value) AS min, max(value) AS max, count(*) AS n "
               f"FROM {src} AS m WHERE {cond} GROUP BY ALL ORDER BY station_id, parameter_name, period_start")

    cap = limit if caller.max_rows is None else min(limit or caller.max_rows, caller.max_rows)
    meta_ = {"start": start_d.isoformat(), "end": end_d.isoformat(), "agg": agg,
             "filters": {"station": station, "parameter": parameter, "state": state, "city": city, "source": source},
             "timezone": "IST (UTC+05:30), naive timestamps"}
    return await _respond(request, caller, sql, format, cap=cap, meta=meta_, filename=f"measurements_{start_d}_{end_d}_{agg}")
