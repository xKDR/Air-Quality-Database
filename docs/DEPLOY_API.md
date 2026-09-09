# Deploying and operating the public API

```
TimescaleDB (maintainers' machine) ──> exporter ──> R2 bucket aqi-data ──> mirror (rclone, Hetzner) ──> api (FastAPI + DuckDB)
 (/path/to/AQIData)                    │                                                  │
                                                   │                                          Cloudflare Tunnel
Users ──> Worker aqi-api (D1 keys, signup, rate limits) ── /v1/files/* ── R2 ─┘                       │
                                                        └─ /v1/*  ───────────────────────────────────────┘
```

* **exporter/** turns the readings table into Hive-partitioned Parquet (one sorted file per month) and uploads it to R2.
* **gateway/** is the Cloudflare Worker: API keys in D1, self-serve signup, rate limits, bulk files from R2, proxy to the api.
* **api/** answers filtered queries over a local mirror of the Parquet tree. Only accepts requests carrying `GATEWAY_SECRET`.

## Current state (2026-09-09)

| Thing | Value |
|---|---|
| Data on R2 | **Published.** 207 month files + stations + parameters + manifest, 410 MB, 196.5 M rows, 2009-01 to 2026-03 |
| Worker | `aqi-api`, live at `https://airquality.xkdr.org` (custom domain) and `aqi-api.xkdr.workers.dev`; bulk files work now, query routes return 503 until the tunnel is up |
| D1 database | `aqi-api-keys` (id `7befe3ad-7104-4c31-85a6-690a6bbf04de`), migration 0001 applied |
| R2 bucket | `aqi-data` (APAC) |
| Turnstile widget | "aqi-api signup" (only used if SIGNUP_MODE is switched to "email") |
| Worker secrets | `ORIGIN_SECRET`, `ADMIN_SECRET`, `TURNSTILE_SECRET` |
| Local `.env` | `GATEWAY_SECRET` (= `ORIGIN_SECRET`), `AQI_ADMIN_SECRET` (= `ADMIN_SECRET`), `AQI_OWNER_API_KEY` (admin-tier key), `R2_BUCKET` |
| Local Parquet copy | the exporter's `--out` directory on the maintainers' machine |

## How keys are issued

`SIGNUP_MODE = "request"` (the default in `wrangler.toml`): the site tells people to email
`CONTACT_EMAIL` (admin@xkdr.org) with their name, organisation and intended use, and offers a pre-filled
mail link. You issue the key at **https://airquality.xkdr.org/admin**:

1. Enter the admin secret (`AQI_ADMIN_SECRET` in `.env`). It stays in that browser tab.
2. Paste the requester's email, name and organisation, click **Generate key**.
3. Click **Open in Gmail** or **Open in mail app**: a reply with the key, a curl example and the docs link is
   pre-filled. Or copy the message text. The key is shown once.
4. The table below lists every key with its last use and 30-day request count, and lets you revoke.

Issued keys default to the `full` tier: **no rate limit, no row cap**, three-minute query timeout. The other
tiers (`dashboard`, `research`, `free`) remain for special cases such as a key embedded in a public web page.

**Demo key.** `DEMO_API_KEY` in `wrangler.toml` is public and appears in every example on the site. It is
the `demo` tier: 10,000 rows per query, 30 requests a minute per IP, no bulk files. Change the value and
redeploy to rotate it.

The self-serve email flow still exists behind `SIGNUP_MODE = "email"` (needs `EMAIL_PROVIDER = "resend"` and
a `RESEND_API_KEY` secret); see `gateway/src/signup.ts`.

## Pages and branding

The Worker serves the site itself: `/` (documentation, with live coverage numbers read from `v1/_manifest.json`
on R2 and cached five minutes), `/signup` (request instructions), `/admin` (key generator). They follow XKDR's
design language (`gateway/src/pages.ts`): off-white `#f2f1f0`, coral `#f57d6a`, black rules, Montserrat
headings, Merriweather body, square corners; logos are inlined in `gateway/src/brand.ts` from xkdr.org.
`/v1/docs` and `/v1/openapi.json` are reachable without a key (IP rate-limited) so people can read the
interactive reference; its Authorize button sends the bearer key through the gateway.

## 1. Exporting data (runs on the maintainers' machine)

Source of truth is the maintainers' TimescaleDB (`readings` + `stations` tables).
The exporter auto-detects its schema (`readings` + `stations`) and also understands the dashboard schema
(`air_quality_data`) on the Hetzner box, so either can feed the same tree.

```bash
export SRC=postgresql://aqi:<password>@localhost:5433/aqi OUT=/path/to/parquet

# After loading new data into TimescaleDB: re-export the months that changed and upload them
python -m exporter.export_parquet --source $SRC --out $OUT --since 2025-01 --upload --threads 6 --memory-limit 6GB --temp-dir $OUT/.tmp

# Everything from scratch (~10 minutes)
python -m exporter.export_parquet --source $SRC --out $OUT --full --upload --threads 6 --memory-limit 6GB --temp-dir $OUT/.tmp

# Only rebuild stations/parameters/manifest from the files on disk
python -m exporter.export_parquet --source $SRC --out $OUT --dimensions-only --upload
```

What the exporter does to the data:

* Publishes `station_id` as `site_NNNN` (the CPCB site number) for CPCB stations and `DS10100NN` for embassy monitors.
* Fills `station_name`, `state`, `city`, `latitude`, `longitude` from the `stations` table, then from
  `stations/station_locations.csv` and `stations/station_locations_11feb2026.csv` by exact and normalised name match.
  62 decommissioned stations (11 with data after 2025-01) are in neither and have null coordinates.
* Renders timestamps `AT TIME ZONE 'UTC'`, which for this database reproduces the source's IST wall-clock values.
* Replaces spaces in parameter names with `_` (`O_Xylene`) and harmonises unit spellings (`UG/M3` → `µg/m³`).
* Uploads each month as soon as it is written, so an interrupted full run can simply be re-run.

Coverage today: CPCB dense through 2024, thin in 2025 (ends 2025-09-01; the local DB is a snapshot), embassy
through 2026-03-27. Loading fresher scraper output into TimescaleDB and re-running `--since` extends it.

## 2. Server side (Hetzner box)

Add to the server's `.env` (copy values from your local `.env`):

```
GATEWAY_SECRET=...        # same value as the Worker's ORIGIN_SECRET
R2_BUCKET=aqi-data
CLOUDFLARE_S3=https://<account-id>.r2.cloudflarestorage.com
CLOUDFLARE_ACCESS_ID=...  # R2 token; read-only on aqi-data is enough here
CLOUDFLARE_SECRET=...
TUNNEL_TOKEN=...          # from step 3
```

Then:

```bash
docker compose build api
docker compose up -d mirror api
docker compose logs -f mirror     # first sync pulls ~0.5 GB, later runs are no-ops unless R2 changed
docker exec aqi-api curl -s localhost:8000/health
```

The `mirror` container re-syncs from R2 every 10 minutes (`MIRROR_INTERVAL_SECONDS`). The api re-reads the
manifest whenever its mtime changes, so new months appear without a restart. The api publishes no host port.

If you would rather skip the mirror, set `PARQUET_DIR=s3://aqi-data` on the api service: it then reads R2
directly. Small queries take ~1 s; multi-year queries take 10 to 35 s, which is why the mirror is the default.

## 3. Cloudflare Tunnel (origin for the Worker)

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared). Name it `aqi-origin`.
2. Copy the tunnel token into `TUNNEL_TOKEN` in the server `.env`, then `docker compose up -d cloudflared`.
3. In the tunnel's **Public Hostname** tab add: subdomain `aqi-origin`, domain `xkdr.org`, service `http://api:8000`.
4. In `gateway/wrangler.toml` set `ORIGIN_URL = "https://aqi-origin.xkdr.org"` and redeploy (`cd gateway && npm run deploy`).

Anyone hitting `aqi-origin.xkdr.org` directly gets a 403 from the api because they lack the gateway secret.

## 4. Email for signups (only if you switch to self-serve)

The Worker is deployed with `EMAIL_PROVIDER = "log"`: verification links are printed to the Worker log
instead of emailed. Fine for testing (`cd gateway && npm run tail`), not for the public.

To send real email with Resend (free tier is plenty):

1. Create a Resend account, add and verify the domain `xkdr.org` (two DNS records, added in Cloudflare DNS).
2. `cd gateway && npx wrangler secret put RESEND_API_KEY`
3. In `wrangler.toml` set `EMAIL_PROVIDER = "resend"`, `EMAIL_FROM = "India Air Quality API <api@xkdr.org>"`,
   and `CONTACT_EMAIL` to whatever address you want on the home page. Redeploy.

## 5. Custom domain

Done: `routes = [{ pattern = "airquality.xkdr.org", custom_domain = true }]` in `gateway/wrangler.toml`;
Cloudflare manages the DNS record and certificate. `workers_dev = true` keeps `aqi-api.xkdr.workers.dev`
answering too.

## 6. Day-to-day operations

All admin calls use `Authorization: Bearer $AQI_ADMIN_SECRET` (from `.env`, never committed). Base `B=https://airquality.xkdr.org`.

```bash
# Who asked for higher limits?
curl -s -H "Authorization: Bearer $AQI_ADMIN_SECRET" "$B/admin/users?wants_upgrade=1"

# Upgrade a key to the research tier (find the id with /admin/keys?email=...)
curl -s -X PATCH -H "Authorization: Bearer $AQI_ADMIN_SECRET" -H 'content-type: application/json' \
  -d '{"tier":"research"}' "$B/admin/keys/<id>"

# Issue a key by hand (e.g. for the dashboard; tier "dashboard" has a low limit)
curl -s -X POST -H "Authorization: Bearer $AQI_ADMIN_SECRET" -H 'content-type: application/json' \
  -d '{"email":"dashboard@xkdr.org","tier":"dashboard","note":"public dashboard"}' "$B/admin/keys"

# Revoke
curl -s -X DELETE -H "Authorization: Bearer $AQI_ADMIN_SECRET" "$B/admin/keys/<id>"

# Usage, last 30 days
curl -s -H "Authorization: Bearer $AQI_ADMIN_SECRET" "$B/admin/usage?days=30"

# Verification links while EMAIL_PROVIDER=log
cd gateway && npm run tail
```

Tier limits live in two places: requests/minute in `gateway/wrangler.toml` (`[[unsafe.bindings]]`) and
rows/query plus timeouts in `api/config.py` (`TIERS`). Change, redeploy the Worker, restart the api.
Most keys are `full` and bypass both.

To let a browser page call this API, issue it a `dashboard` tier key, set `ALLOWED_ORIGINS` in
`wrangler.toml` to the page's origin, and redeploy.

## 7. Local development

```bash
# Query API against the local Parquet tree, no gateway
PARQUET_DIR=/path/to/parquet API_DEV_MODE=1 uvicorn api.main:app --port 8010

# Worker with local D1 and R2 emulation
cd gateway && cp .dev.vars.example .dev.vars && npm install && npm run migrate:local && npm run dev
# then: POST /signup with DEV_MODE=true returns dev_verify_url; GET it with Accept: application/json to get a key.
```

## Security notes

* Keys are stored as SHA-256 hashes. A D1 leak yields nothing that grants access.
* Revocation and tier changes take effect immediately in the isolate that made them and within 60 s elsewhere.
* The api trusts `x-key-id` / `x-tier` headers only when `x-gateway-secret` matches. Keep `API_DEV_MODE` off in production.
* Rotate `ADMIN_SECRET` with `wrangler secret put ADMIN_SECRET` and update `AQI_ADMIN_SECRET` in `.env`.
* `.env` is excluded from the Docker build context (`.dockerignore`); compose passes variables explicitly.
