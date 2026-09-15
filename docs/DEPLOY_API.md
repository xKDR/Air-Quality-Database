# Deploying and operating the public API

```
TimescaleDB (maintainers' machine) ──> exporter ──> R2 bucket aqi-data
                                                      │         ▲
Users ──> Worker aqi-api (D1 keys, signup, limits) ───┤         │ S3 API (read-only token)
                          /v1/files/*  ── R2 binding ─┘         │
                          /v1/*        ──> Cloud Run aqi-query (api/: FastAPI + DuckDB, asia-south1)
```

The gateway, keys and files run on Cloudflare's free plan. The query service runs on Google Cloud Run and scales to
zero between requests. There is no server to manage.

* **exporter/** turns the readings table into Hive-partitioned Parquet (one sorted file per month) and uploads it to R2.
* **gateway/** is the Cloudflare Worker: API keys in D1, self-serve signup, rate limits, bulk files from R2, proxy to the api.
* **api/** answers filtered queries by reading the Parquet tree on R2. It runs on Google Cloud Run (service `aqi-query`) and only accepts requests carrying `GATEWAY_SECRET`.

## Current state (2026-09-09)

| Thing | Value |
|---|---|
| Data on R2 | **Published.** 207 month files + stations + parameters + manifest, 410 MB, 196.5 M rows, 2009-01 to 2026-03 |
| Worker | `aqi-api`, live at `https://airquality.xkdr.org` (custom domain) and `aqi-api.xkdr.workers.dev`; bulk files work now; query routes are proxied to the Cloud Run service (section 2) |
| D1 database | `aqi-api-keys` (id `7befe3ad-7104-4c31-85a6-690a6bbf04de`), migration 0001 applied |
| R2 bucket | `aqi-data` (APAC) |
| Turnstile widget | "aqi-api signup" (only used if SIGNUP_MODE is switched to "email") |
| Worker secrets | `ORIGIN_SECRET`, `ADMIN_SECRET`, `TURNSTILE_SECRET` |
| Local `.env` | `GATEWAY_SECRET` (= `ORIGIN_SECRET`), `AQI_ADMIN_SECRET` (= `ADMIN_SECRET`), `AQI_OWNER_API_KEY` (admin-tier key), `R2_BUCKET` |
| Local Parquet copy | the exporter's `--out` directory on the maintainers' machine |

## How keys are issued

`SIGNUP_MODE = "instant"` (the default in `wrangler.toml`): people fill in the form at `/signup`, pass Cloudflare
Turnstile (widget "aqi-api signup": `TURNSTILE_SITE_KEY` var, `TURNSTILE_SECRET` secret), and get a key on the
next page, shown once. The only gate is Turnstile: the token is verified server-side and works once. There is no
signup rate limit and no cap on keys per email, and signing up never revokes existing keys (the email is not
verified). Name, affiliation and purpose go to the `users` table.

Every key, self-serve or hand-issued, is on the `full` tier: no rate limit, no row cap, 90-second query timeout
(Cloudflare cuts responses that take longer than 100 seconds). Only the demo key is limited. At
**https://airquality.xkdr.org/admin** (admin secret = `AQI_ADMIN_SECRET` in `.env`) you can list keys, revoke one,
or issue one by hand.

`SIGNUP_MODE = "request"` switches back to "email us and we issue keys by hand": the admin page pre-fills the reply
with the key, a curl example and the docs link.

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
(`air_quality_data`), so either can feed the same tree.

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

## 2. Query service on Google Cloud Run

The query service (`api/`, FastAPI + DuckDB) runs on Google Cloud Run. It reads the Parquet files straight from R2
over the S3 API, scales to zero between requests, and refuses anything without the gateway secret. (Cloudflare
Containers would keep it on Cloudflare but need the Workers Paid plan; that was tried and rolled out of the config.)

| Item | Value |
|---|---|
| Service | `aqi-query` in project `gen-lang-client-0400158481`, region `asia-south1`. The other services in that project belong to other products: leave them alone. |
| URL | https://aqi-query-35101441745.asia-south1.run.app, set as `ORIGIN_URL` in `gateway/wrangler.toml` |
| Service account | `aqi-query-runtime@gen-lang-client-0400158481.iam.gserviceaccount.com`, no roles (the service needs no Google permissions) |
| Image | `asia-south1-docker.pkg.dev/gen-lang-client-0400158481/cloud-run-source-deploy/aqi-query:<tag>`, built from `api/Dockerfile` |
| Size | 2 vCPU, 4 GiB, concurrency 8, request timeout 300 s, 0 to 2 instances |
| Env vars | `PARQUET_DIR=s3://aqi-data`; `CLOUDFLARE_S3`, `CLOUDFLARE_ACCESS_ID`, `CLOUDFLARE_SECRET` = the read-only R2 token (`R2_*` in `.env`); `GATEWAY_SECRET` = the Worker's `ORIGIN_SECRET`; `API_DUCKDB_THREADS=16` (reads from R2 are network-bound, so threads help even on 2 vCPU: a cold 10-year city query went from 93 s to 29 s), `API_DUCKDB_MEMORY_LIMIT=3GB`, `API_QUERY_TIMEOUT_SECONDS=30`, `API_QUERY_TIMEOUT_FULL_SECONDS=90` (must stay under Cloudflare's 100 s limit, or callers get a bare 524) |

Ship a code change (build locally, push, deploy; env vars are kept):

```bash
P=gen-lang-client-0400158481
IMG=asia-south1-docker.pkg.dev/$P/cloud-run-source-deploy/aqi-query:$(date +%Y%m%d-%H%M)
docker build --platform linux/amd64 -f api/Dockerfile -t "$IMG" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin https://asia-south1-docker.pkg.dev
docker push "$IMG"
gcloud run deploy aqi-query --image "$IMG" --region asia-south1 --project $P --quiet
```

Change a setting without rebuilding: `gcloud run services update aqi-query --region asia-south1 --update-env-vars KEY=value`.
Never pass `--set-env-vars` to an existing service: it replaces the whole set.

Rotate the gateway secret by setting the same new value on both sides:

```bash
cd gateway && npx wrangler secret put ORIGIN_SECRET
gcloud run services update aqi-query --region asia-south1 --update-env-vars GATEWAY_SECRET=<same value>
```

Roll back: `gcloud run revisions list --service aqi-query --region asia-south1`, then
`gcloud run services update-traffic aqi-query --region asia-south1 --to-revisions <REVISION>=100`.

Cost: Cloud Run's monthly free allowance covers light use; beyond it you pay only for the seconds an instance spends
handling requests. The first request after an idle spell takes a few extra seconds while an instance starts. Logs:
`gcloud run services logs read aqi-query --region asia-south1`.

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
