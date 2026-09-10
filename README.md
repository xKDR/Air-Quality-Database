# India Air Quality Database

Hourly pollutant readings from every station in India's CPCB continuous monitoring network (553 stations,
2009 onwards) and the five US Embassy and Consulate monitors, published by [XKDR Forum](https://www.xkdr.org)
as an API and as bulk Parquet files.

**https://airquality.xkdr.org**

## Quickstart notebook

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/xKDR/Air-Quality-Database/blob/main/india_air_quality_quickstart.ipynb)

[`india_air_quality_quickstart.ipynb`](india_air_quality_quickstart.ipynb) walks through the data with the public demo key:
what is published, where the stations are, pulling one year into the runtime, plots of Delhi's November smog,
five cities through the year, the daily cycle, and maps of annual and November PM2.5 by station. Runs top to bottom in Google Colab in about a minute.

## What's in this repository

| Path | What |
|---|---|
| `india_air_quality_quickstart.ipynb` | The Colab notebook above |
| `gateway/` | Cloudflare Worker: the website, API keys (D1), the admin key generator, rate limits, bulk files from R2, proxy to the query service |
| `api/` | Query service: FastAPI + DuckDB over the Parquet files, behind the gateway |
| `exporter/` | Postgres/TimescaleDB to Hive-partitioned Parquet, uploaded to R2 |
| `stations/` | Station location files used to fill coordinates |
| `docs/PUBLIC_API.md` | User documentation |
| `docs/DEPLOY_API.md` | How the pieces are deployed and operated |
| `docker-compose.yml` | Server-side stack: R2 mirror, query service, Cloudflare Tunnel |

The data itself lives on Cloudflare R2 (about 410 MB of Parquet, 196 million rows) and is served through
the API; it is not in this repository.

## Getting a key

The demo key on the website reads the 2024 files and is capped at 10,000 rows per API query. For the whole
archive with no limits, email **admin@xkdr.org** with your name, your organisation, and how you plan to use
the data. See https://airquality.xkdr.org/signup.

## Using the API

```bash
# Daily PM2.5 for every monitor in Delhi, November 2024, as CSV
curl -H "Authorization: Bearer aqi_demo_wbf92Qx21zX-Wa_Tg8Dx1nXe" \
  "https://airquality.xkdr.org/v1/measurements?city=Delhi&parameter=PM2.5&start=2024-11-01&end=2024-11-30&agg=daily&format=csv"
```

| Endpoint | What you get |
|---|---|
| `GET /v1/meta` | Export time, months covered, row counts, schema |
| `GET /v1/stations` | Stations with coordinates; filters `source`, `state`, `city`, `q` |
| `GET /v1/parameters` | Pollutants and units |
| `GET /v1/measurements` | The time series; filter by `station`, `parameter`, `city`, `state`, `source`, `start`, `end`; `agg` = raw, hourly, daily, monthly; `format` = json, csv, parquet |
| `GET /v1/files` | The bulk Parquet files, one per month |

Full reference: https://airquality.xkdr.org/#docs

## Data notes

* Timestamps are Indian Standard Time. CPCB readings sit on the hour, embassy readings at half past.
* Values are as reported by the networks: no gap filling, outlier removal or calibration.
* `station_id` is CPCB's site number (`site_103`) or the embassy id (`DS1010001`).
* Each month file is sorted by station, pollutant and time, so Parquet readers skip most of a file when filtering on a station.

## Attribution

Data: Central Pollution Control Board (CPCB), Continuous Ambient Air Quality Monitoring network; US Department
of State air quality monitors via AirNow. Please credit both sources and *India Air Quality API, XKDR Forum*
in publications. Do not resell the raw data.
