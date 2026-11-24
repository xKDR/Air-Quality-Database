"""
Assemble the exporter's source as a DuckDB file of views over Parquet/CSV, so the public v1 files can be
built without a Postgres database.

Inputs (all read in place, nothing is copied into the DuckDB file except two small tables):

    --cpcb-hourly     glob of CPCB hourly Parquet built from CPCB's raw portal files
                      (columns station_id, time, parameter, unit, value; times naive IST)
    --cpcb-manifest   the CPCB manifest JSON (per site: name, state, city, years)
    --supplement      Parquet of CPCB rows that exist only in the old scraper's database
                      (columns station_id, time, parameter, value, unit). Optional.
    --embassy-csv     glob of US embassy hourly CSVs (collected_at naive UTC, qc flag). Optional.
    --coords          CSV(s) keyed by station_id with latitude/longitude (first file wins per id);
                      a `coord_source` column is carried through when present.

The result has the exporter's "timescale" schema:

    readings(time TIMESTAMP, station_id, parameter, value, unit)
    stations(station_id, station_name, state, city, latitude, longitude, coord_source)

Rules applied here:
  * Embassy rows flagged qc = 'Invalid' by the State Department are dropped (as in every earlier release).
    Embassy times stay in UTC, as published.
  * Weather series (AT, RH, WS, WD, VWS, RF, TOT-RF, SR, BP) that hold a single constant value for a whole
    station-year are dropped: CPCB files fill missing sensors with 0 (e.g. rainfall at stations with no gauge).
    Pollutant values are never altered or dropped.

Example:
    python -m exporter.make_source_db --out /data/source.duckdb \
        --cpcb-hourly '/data/env/cpcb/hourly/*/*.parquet' --cpcb-manifest /data/env/cpcb/meta/manifest.json \
        --supplement /data/supplement_legacy_2025.parquet \
        --embassy-csv '/data/embassy/DS*_hourly.csv' \
        --coords stations/station_coordinates_2026-11-23.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
from pathlib import Path

import duckdb

logger = logging.getLogger("make_source_db")

WEATHER = ("AT", "RH", "WS", "WD", "VWS", "RF", "TOT-RF", "SR", "BP")


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def build(out: Path, cpcb_hourly: str, cpcb_manifest: Path, coords: list[Path],
          supplement: Path | None, embassy_csv: str | None) -> None:
    out.unlink(missing_ok=True)
    con = duckdb.connect(str(out))

    # Weather station-years that are one constant value (filled, not measured).
    con.execute(f"""
        CREATE TABLE weather_constant AS
        SELECT station_id, year(time) AS yr, parameter
        FROM read_parquet({_q(cpcb_hourly)})
        WHERE parameter IN {WEATHER}
        GROUP BY ALL HAVING min(value) = max(value)""")
    n_const = con.execute("SELECT count(*) FROM weather_constant").fetchone()[0]
    logger.info("weather_constant: %d station-year-parameter series dropped", n_const)

    parts = [f"""
        SELECT h.time, h.station_id, h.parameter, h.value, h.unit
        FROM read_parquet({_q(cpcb_hourly)}) h
        ANTI JOIN weather_constant w
          ON w.station_id = h.station_id AND w.yr = year(h.time) AND w.parameter = h.parameter"""]
    if supplement:
        parts.append(f"SELECT time, station_id, parameter, value, unit FROM read_parquet({_q(str(supplement))})")
    if embassy_csv:
        parts.append(f"""
            SELECT collected_at::TIMESTAMP AS time, station_id, parameter, value::DOUBLE AS value, unit
            FROM read_csv({_q(embassy_csv)}, union_by_name = true)
            WHERE coalesce(qc, '') <> 'Invalid' AND value IS NOT NULL""")
    con.execute("CREATE VIEW readings AS " + "\nUNION ALL\n".join(parts))

    # Stations: names/state/city from the CPCB manifest, coordinates by id only (no name matching).
    sites = json.loads(cpcb_manifest.read_text())["sites"]
    coord: dict[str, tuple] = {}
    for p in coords:
        with p.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                sid = (r.get("station_id") or "").strip()
                if not sid or sid in coord or not r.get("latitude"):
                    continue
                coord[sid] = (float(r["latitude"]), float(r["longitude"]),
                              (r.get("coord_source") or p.stem).strip(),
                              (r.get("station_name") or "").strip() or None,
                              (r.get("state") or "").strip() or None, (r.get("city") or "").strip() or None)
    rows = []
    for sid, m in sites.items():
        lat, lon, src, cname, cstate, ccity = coord.get(sid, (None, None, None, None, None, None))
        rows.append((sid, m.get("name") or cname, m.get("state") or cstate, m.get("city") or ccity, lat, lon, src))
    con.execute("CREATE TABLE stations (station_id VARCHAR, station_name VARCHAR, state VARCHAR, city VARCHAR, "
                "latitude DOUBLE, longitude DOUBLE, coord_source VARCHAR)")
    con.executemany("INSERT INTO stations VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    n, n_xy = con.execute("SELECT count(*), count(latitude) FROM stations").fetchone()
    logger.info("stations: %d CPCB sites, %d with coordinates", n, n_xy)
    con.close()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--cpcb-hourly", required=True)
    p.add_argument("--cpcb-manifest", required=True, type=Path)
    p.add_argument("--coords", nargs="+", required=True, type=Path)
    p.add_argument("--supplement", type=Path)
    p.add_argument("--embassy-csv")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    build(args.out, args.cpcb_hourly, args.cpcb_manifest, args.coords, args.supplement, args.embassy_csv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
