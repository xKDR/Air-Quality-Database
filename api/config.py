import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SCHEMA_VERSION = "v1"
# Local directory (e.g. /data/parquet) or an S3/R2 URL (e.g. s3://aqi-data). For R2, also set
# CLOUDFLARE_S3, CLOUDFLARE_ACCESS_ID and CLOUDFLARE_SECRET.
PARQUET_DIR = os.environ.get("PARQUET_DIR", "parquet_out")
IS_REMOTE = PARQUET_DIR.startswith(("s3://", "r2://", "gs://"))
if not IS_REMOTE:
    PARQUET_DIR = str(Path(PARQUET_DIR).resolve())
DATA_ROOT = f"{PARQUET_DIR.rstrip('/')}/{SCHEMA_VERSION}"

# Shared secret the gateway Worker sends in x-gateway-secret. Direct requests without it are refused.
GATEWAY_SECRET = os.environ.get("GATEWAY_SECRET", "")
# Dev mode: no gateway secret needed; tier can be spoofed via x-tier. Never set in production.
DEV_MODE = os.environ.get("API_DEV_MODE", "0") == "1"

DUCKDB_THREADS = int(os.environ.get("API_DUCKDB_THREADS", "4"))
DUCKDB_MEMORY_LIMIT = os.environ.get("API_DUCKDB_MEMORY_LIMIT", "2GB")
QUERY_TIMEOUT_SECONDS = float(os.environ.get("API_QUERY_TIMEOUT_SECONDS", "30"))
MANIFEST_TTL_SECONDS = 60.0  # remote manifests are re-read at most this often

# Per-tier limits (the gateway enforces requests/minute; the origin enforces rows/request and the query timeout).
# max_rows None = unlimited. "full" is the default for issued keys: no caps, longer timeout.
TIERS: dict[str, dict] = {
    "full":      {"max_rows": None,       "timeout": float(os.environ.get("API_QUERY_TIMEOUT_FULL_SECONDS", "180"))},
    "admin":     {"max_rows": None,       "timeout": float(os.environ.get("API_QUERY_TIMEOUT_FULL_SECONDS", "180"))},
    "research":  {"max_rows": 5_000_000,  "timeout": QUERY_TIMEOUT_SECONDS},
    "free":      {"max_rows": 100_000,    "timeout": QUERY_TIMEOUT_SECONDS},
    "dashboard": {"max_rows": 100_000,    "timeout": QUERY_TIMEOUT_SECONDS},
    "demo":      {"max_rows": 10_000,     "timeout": QUERY_TIMEOUT_SECONDS},  # the public key on the website
}
DEFAULT_TIER = "free"  # what an unknown tier header falls back to; the gateway always sends a real one
# JSON is verbose; capped tiers stop here and are told to use csv or parquet. Unlimited tiers are not capped.
JSON_MAX_ROWS = int(os.environ.get("API_JSON_MAX_ROWS", "200000"))
# Default window when start/end are omitted.
DEFAULT_WINDOW_DAYS = 30
