# India Air Quality API

Hourly pollutant and weather time series from India's CPCB CAAQM monitoring network (642 stations, 2009
onwards) and the US Embassy and Consulate monitors (5 stations, 2013 onwards), served two ways:

* a **query API** for filtered or aggregated slices (JSON, CSV or Parquet), and
* **bulk Parquet files**, one per month, for people who want everything.

Base URL: `https://airquality.xkdr.org`

## Getting a key

Get one in about a minute at **https://airquality.xkdr.org/signup**: give your name and email (organisation
and intended use are optional), pass Cloudflare's human check, and the key appears on the next page. It is
shown once, so store it. Keys never expire. If you lose one, sign up again for a new one.

Send the key as a bearer token on every request:

```bash
curl -H "Authorization: Bearer aqi_..." "https://airquality.xkdr.org/v1/meta"
```

**Demo key.** Every example on the site uses a public demo key (shown on the home page) so you can try the
API before asking. It is capped at 10,000 rows per query and 300 requests a minute per IP address, and it
can only read the 2024 bulk files.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/v1/meta` | What is published: export time, months covered, row counts, schema, your tier. |
| GET | `/v1/stations` | Stations with coordinates and available parameters. Filters: `source`, `state`, `city`, `q` (name substring). |
| GET | `/v1/parameters` | Pollutants and units. |
| GET | `/v1/measurements` | The time series. See below. |
| GET | `/v1/files` | List of bulk files with sizes and row counts. |
| GET | `/v1/files/<key>` | Download a bulk file. Supports `Range`, so DuckDB can read files in place. |
| GET | `/v1/docs` | Interactive OpenAPI documentation. |

All endpoints except `/v1/files/<key>` accept `format=json|csv|parquet` (default `json`).

### `/v1/measurements`

| Parameter | Meaning |
|---|---|
| `station` | `station_id`, repeatable (`station=DS1010001&station=site_5024`). |
| `parameter` | e.g. `PM2.5`, `PM10`, `NO2`, `SO2`, `Ozone`, `CO`. Repeatable. |
| `state`, `city` | Case-insensitive exact match. |
| `source` | `cpcb_caaqm` or `us_embassy`. |
| `start`, `end` | `YYYY-MM-DD`, inclusive, applied to `collected_at` as stored (IST for CPCB, UTC for embassy rows). Default: last 30 days. |
| `agg` | `raw` (default), `hourly`, `daily`, `monthly`. Aggregates return `mean`, `min`, `max`, `n` per period. |
| `limit` | Row cap, at most your tier's maximum. |

Raw rows: `station_id, parameter_name, unit, collected_at, value`.
Join `station_id` to `/v1/stations` for names and coordinates.

Every response carries `X-Row-Count` and `X-Truncated` headers. JSON responses also carry a `meta`
object. When `truncated` is true the query hit the row cap: narrow it, aggregate, or use the bulk files.

Examples:

```bash
# Daily PM2.5 for every monitor in Delhi, November 2024, as CSV
curl -H "Authorization: Bearer $KEY" \
  "$BASE/v1/measurements?city=Delhi&parameter=PM2.5&start=2024-11-01&end=2024-11-30&agg=daily&format=csv"

# Raw hourly PM2.5 and PM10 for one station, one week, as Parquet
curl -H "Authorization: Bearer $KEY" -o alipur.parquet \
  "$BASE/v1/measurements?station=site_5024&parameter=PM2.5&parameter=PM10&start=2025-04-01&end=2025-04-07&format=parquet"

# Monthly means for all US embassy monitors, 2023
curl -H "Authorization: Bearer $KEY" \
  "$BASE/v1/measurements?source=us_embassy&start=2023-01-01&end=2023-12-31&agg=monthly"
```

## Bulk files

`/v1/files` lists everything. Keys look like:

```
v1/measurements/year=2024/month=03/data.parquet
v1/stations.parquet
v1/parameters.parquet
v1/_manifest.json
```

Each month file is sorted by `station_id, parameter_name, collected_at` with one-million-row row
groups, so engines that read Parquet statistics skip most of a file when you filter on a station.

Read them in place with DuckDB, no download step. Wildcards do not work over HTTPS (DuckDB cannot
list a web server), so name the files explicitly:

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET aqi (TYPE http, BEARER_TOKEN 'aqi_...');

SELECT station_id, date_trunc('day', collected_at) AS day, avg(value) AS pm25
FROM read_parquet(
  list_transform(range(10, 13), m -> format('https://airquality.xkdr.org/v1/files/v1/measurements/year=2024/month={:02d}/data.parquet', m)),
  hive_partitioning = true)
WHERE parameter_name = 'PM2.5'
GROUP BY ALL ORDER BY ALL;
```

Or download once and query locally:

```bash
for k in $(curl -s -H "Authorization: Bearer $KEY" $BASE/v1/files | jq -r '.files[].key'); do
  mkdir -p "$(dirname "$k")"
  curl -s -H "Authorization: Bearer $KEY" -o "$k" "$BASE/v1/files/$k"
done
duckdb -c "SELECT count(*) FROM read_parquet('v1/measurements/*/*/data.parquet', hive_partitioning=true)"
```

## Schema

| Column | Type | Notes |
|---|---|---|
| `station_id` | text | `site_NNNN` (the CPCB site number) for CPCB, `DS10100NN` for US embassy monitors. |
| `station_name`, `state_name`, `city_name` | text | As published by the source. |
| `parameter_name` | text | Pollutants: `PM2.5`, `PM10`, `NO`, `NO2`, `NOx`, `NH3`, `SO2`, `CO`, `Ozone`, `Benzene`, `Toluene`, `Xylene`, `O_Xylene`, `MP-Xylene`, `Eth-Benzene`. Weather (CPCB stations that have the sensor): `AT` air temperature, `RH` relative humidity, `WS` wind speed, `WD` wind direction, `VWS` vertical wind speed, `RF` rainfall, `TOT-RF` total rainfall, `SR` solar radiation, `BP` barometric pressure. |
| `unit` | text | Harmonised: `µg/m³`, `mg/m³`, etc. |
| `collected_at` | timestamp | Naive. **CPCB rows: Indian Standard Time (UTC+05:30)**, on the hour. **US embassy rows: UTC**, stamped at half past for the hour starting on the hour (AirNow's convention), so `2024-11-01 06:30` is 06:00–07:00 UTC = 11:30–12:30 IST. Add 5:30 to embassy times before comparing them with CPCB. |
| `value` | double | As reported. No gap filling or outlier removal. Embassy readings the State Department flagged invalid are left out. A weather series that is one constant value for a whole station-year (CPCB fills a missing sensor with 0) is left out. |
| `source` | text | `cpcb_caaqm` or `us_embassy`. |
| `year`, `month` | int | Hive partition columns (bulk files only). |

`stations.parquet` adds `latitude`, `longitude`, `first_seen`, `last_seen`, `n_rows` and the list of
`parameters` each station reports, and `coord_source`, which says where the coordinate comes from:
`cpcb_portal_2026-11-23` (CPCB's own station list, matched by station id), `cpcb_repository_2026-11-23`
(CPCB's data-repository station master), `retained_previous` (a decommissioned station CPCB no longer lists;
the coordinate is carried over from earlier releases and is unverified) or `us_embassy`. Coordinates are only
ever matched by station id, never by name. Stations CPCB no longer lists and for which no coordinate could be
verified have null coordinates; filter them by `station_id` or name instead.

## Coverage

| | Rows | Stations | From | To |
|---|---|---|---|---|
| CPCB CAAQM | 446.6 M (pollutants and weather) | 642 (605 reporting in 2026) | 2009-01 | 2026-11 |
| US Embassy | 0.50 M | 5 | 2013-01 | 2026-11 (Kolkata to 2025-02, Hyderabad to 2026-04) |

CPCB data is refreshed from CPCB's portal by hand, roughly monthly; the embassy series comes from the US
State Department's historical files and AirNow.

Station counts grow over time: about 20 stations in 2010, 130 in 2018, 530 in 2024. `/v1/meta` reports the
current extent; `/v1/stations` gives `first_seen` and `last_seen` per station.

## Limits

Every key has **no rate limit and no row cap**; only the demo key is limited. Two practical notes: JSON is
verbose, so ask for `format=csv` or `parquet` when you expect more than a few hundred thousand rows; and a
single query times out after 90 seconds, so pull whole years from the bulk files rather than through
`/v1/measurements`.

The demo key is limited (see above).

## Errors

Errors are JSON: `{"error": "<code>", "detail": "<human readable>"}`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_parameter`, `request_error` | Bad input. |
| 401 | `missing_api_key`, `invalid_api_key` | Send a valid bearer token. |
| 429 | `rate_limited` | Demo key only: slow down; see `Retry-After`. |
| 403 | `demo_key` | The demo key can only read the 2024 bulk files. |
| 503 | `no_data`, `origin_unavailable` | Data not published yet or the query service is down. |
| 504 | `query_timeout` | Narrow the query. |

## Licence, attribution and warranty

The compilation is released under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
You may use, share and adapt it for any purpose, including commercial work, provided you credit
*India Air Quality Database, XKDR Forum* and the sources: the Central Pollution Control Board's Continuous
Ambient Air Quality Monitoring network, and the US Department of State via AirNow.

The data is provided as is, without warranty of any kind. It is published as received from the monitoring
networks, which themselves label readings preliminary and not fully validated, and it has not been validated
by XKDR for regulatory, legal or health decisions. Check against the source for anything that matters.
