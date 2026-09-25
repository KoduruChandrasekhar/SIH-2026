"""
TraceNet Phase 5 — macro traffic analytics on Polars.

    PostgreSQL (vehicle_observations ⋈ cameras, global_trajectories)
        ↓  Arrow-native read: connectorx → ADBC → psycopg (first that works)
    Polars
        ↓  legs      contiguous observations of one trajectory (camera_a → camera_b), with
        ↓            road distance (OSRM table) and implied speed
        ↓  corridor  per camera × hour and per camera over the rolling window:
        ↓            vehicle_count (every chassis, plate or not), ocr_yield (confidence > 0.80),
        ↓            avg_speed (cross-camera legs touching the camera), avg_delay, BCI
        ↓  O-D       (source_camera, destination_camera) trip counts over the last 24 h
    corridor_stats / od_matrix / analytics_runs  (upserted; the API only reads these)

    BCI = 1 − v_observed / v_freeflow  (v_freeflow = 60 km/h), clipped to [0, 1]
    BCI ≥ 0.70 → STATUS_SEVERE · ≥ 0.40 → STATUS_MODERATE · else STATUS_FREE ·
    no speed evidence → STATUS_NO_DATA (BCI NULL — never guessed)

Legs that are excluded from speeds / O-D: same-camera legs (tracker fragments, 0 km), legs
with Δt ≤ 0, legs faster than 150 km/h, and every leg of a cloned-plate trajectory.

    python -m backend.analytics.polars_jobs            # run once, print the results
"""

from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import polars as pl
import psycopg
from psycopg.types.json import Jsonb

from backend.db.config import PROJECT_ROOT, database_url, redact

log = logging.getLogger("tracenet.analytics")

V_FREEFLOW_KMH = 60.0
BCI_SEVERE = 0.70
BCI_MODERATE = 0.40
MAX_PLAUSIBLE_KMH = 150.0
OCR_YIELD_CONFIDENCE = 0.80
WINDOW_HOURS = 24
LOCAL_TZ = "Asia/Kolkata"          # hourly buckets follow local clock hours
ROAD_NETWORK = PROJECT_ROOT / "backend" / "config" / "road_network.json"
READ_ENGINES = ("connectorx", "adbc", "psycopg")


# ─── Arrow-native read ───────────────────────────────────────────────────────

CONNECT_TIMEOUT_S = 3


def _with_timeout(url: str) -> str:
    """connectorx / ADBC otherwise wait minutes for an unreachable server."""
    return url if "connect_timeout=" in url else f"{url}{'&' if '?' in url else '?'}connect_timeout={CONNECT_TIMEOUT_S}"


def ensure_reachable(url: str) -> None:
    """Fail fast (≈3 s) when PostgreSQL is down, instead of stalling a scheduler iteration."""
    psycopg.connect(url, connect_timeout=CONNECT_TIMEOUT_S).close()


def read_frame(sql: str, url: str, engines: tuple[str, ...] = READ_ENGINES) -> tuple[pl.DataFrame, str]:
    """Read a query into Polars with the first engine that works; returns (frame, engine)."""
    errors = []
    for engine in engines:
        try:
            if engine in ("connectorx", "adbc"):
                return pl.read_database_uri(sql, _with_timeout(url), engine=engine), engine
            if engine == "psycopg":
                with psycopg.connect(url, connect_timeout=CONNECT_TIMEOUT_S) as conn:
                    return pl.read_database(sql, connection=conn, infer_schema_length=None), engine
            raise ValueError(f"unknown read engine '{engine}'")
        except Exception as exc:        # missing package / binary / driver problem → next engine
            errors.append(f"{engine}: {type(exc).__name__}: {exc}")
    raise RuntimeError("No Polars read engine could query PostgreSQL — " + " | ".join(errors))


def road_distances() -> pl.DataFrame:
    net = json.loads(ROAD_NETWORK.read_text(encoding="utf-8"))
    return pl.DataFrame(
        [{"camera_a": a, "camera_b": b, "road_km": float(km)} for a, row in net["distances_km"].items() for b, km in row.items()],
        schema={"camera_a": pl.String, "camera_b": pl.String, "road_km": pl.Float64},
    )


# ─── pure computations (DataFrame in → DataFrame out) ────────────────────────

def compute_legs(obs: pl.DataFrame, roads: pl.DataFrame, cloned: set[str]) -> pl.DataFrame:
    """Contiguous (camera_a → camera_b) legs per trajectory, with speed and a validity flag."""
    legs = (
        obs.filter(pl.col("trajectory_id").is_not_null())
        .sort(["trajectory_id", "observed_at", "id"])
        .with_columns(
            pl.col("camera_code").shift(1).over("trajectory_id").alias("camera_a"),
            pl.col("observed_at").shift(1).over("trajectory_id").alias("departed_at"),
        )
        .filter(pl.col("camera_a").is_not_null())
        .rename({"camera_code": "camera_b", "observed_at": "arrived_at"})
        .select("trajectory_id", "camera_a", "camera_b", "departed_at", "arrived_at", "source")
        .join(roads, on=["camera_a", "camera_b"], how="left")
        .with_columns(((pl.col("arrived_at") - pl.col("departed_at")).dt.total_microseconds() / 3.6e9).alias("hours"))
        .with_columns(
            pl.when(pl.col("hours") > 0).then(pl.col("road_km") / pl.col("hours")).otherwise(None).alias("speed_kmh"),
            (pl.col("hours") * 60 - pl.col("road_km") / V_FREEFLOW_KMH * 60).alias("delay_min"),
        )
    )
    return legs.with_columns(
        (
            (pl.col("camera_a") != pl.col("camera_b"))
            & pl.col("road_km").is_not_null()
            & (pl.col("hours") > 0)
            & (pl.col("speed_kmh") <= MAX_PLAUSIBLE_KMH)
            & ~pl.col("trajectory_id").is_in(list(cloned))
        ).fill_null(False).alias("valid")
    )


def _bci_columns(df: pl.DataFrame) -> pl.DataFrame:
    bci = (1.0 - pl.col("avg_speed_kmh") / V_FREEFLOW_KMH).clip(0.0, 1.0)
    return df.with_columns(bci.alias("bci_score")).with_columns(
        pl.when(pl.col("bci_score").is_null()).then(pl.lit("STATUS_NO_DATA"))
        .when(pl.col("bci_score") >= BCI_SEVERE).then(pl.lit("STATUS_SEVERE"))
        .when(pl.col("bci_score") >= BCI_MODERATE).then(pl.lit("STATUS_MODERATE"))
        .otherwise(pl.lit("STATUS_FREE")).alias("status"),
        (pl.col("bci_score") >= BCI_SEVERE).fill_null(False).alias("is_severe"),
    )


def _leg_endpoints(legs: pl.DataFrame) -> pl.DataFrame:
    """Each valid leg counts toward the corridor speed of both cameras it links."""
    valid = legs.filter(pl.col("valid"))
    return pl.concat([
        valid.select(pl.col("camera_a").alias("camera_code"), pl.col("departed_at").alias("at"), "speed_kmh", "delay_min"),
        valid.select(pl.col("camera_b").alias("camera_code"), pl.col("arrived_at").alias("at"), "speed_kmh", "delay_min"),
    ])


def corridor_stats(obs: pl.DataFrame, legs: pl.DataFrame, cameras: list[str],
                   window_start: datetime, window_end: datetime) -> tuple[pl.DataFrame, pl.DataFrame]:
    """(hourly, rollup) corridor KPIs for observations inside [window_start, window_end)."""
    in_window = obs.filter(pl.col("observed_at").is_between(window_start, window_end, closed="left"))
    ends = _leg_endpoints(legs).filter(pl.col("at").is_between(window_start, window_end, closed="left"))

    def volume(frame: pl.DataFrame, keys: list[str]) -> pl.DataFrame:
        return frame.group_by(keys).agg(
            pl.len().cast(pl.Int64).alias("vehicle_count"),
            (pl.col("integrity_flags") == "VALID").sum().cast(pl.Int64).alias("plated_count"),
            (pl.col("confidence") > OCR_YIELD_CONFIDENCE).mean().alias("ocr_yield"),
            pl.struct("source").value_counts().alias("_sources"),
        )

    def speeds(frame: pl.DataFrame, keys: list[str]) -> pl.DataFrame:
        return frame.group_by(keys).agg(
            pl.col("speed_kmh").mean().alias("avg_speed_kmh"),
            pl.len().cast(pl.Int64).alias("speed_samples"),
            pl.col("delay_min").mean().alias("avg_delay_min"),
        )

    # hourly buckets
    local_hour = lambda c: pl.col(c).dt.convert_time_zone(LOCAL_TZ).dt.truncate("1h").alias("bucket_start")  # noqa: E731
    hourly_obs = in_window.with_columns(local_hour("observed_at"))
    hourly_legs = ends.with_columns(local_hour("at"))
    hourly = (
        volume(hourly_obs, ["camera_code", "bucket_start"])
        .join(speeds(hourly_legs, ["camera_code", "bucket_start"]), on=["camera_code", "bucket_start"], how="full", coalesce=True)
        .with_columns(
            (pl.col("bucket_start") + pl.duration(hours=1)).alias("bucket_end"),
            pl.lit("1h").alias("window_label"),
        )
    )

    # rolling window rollup, one row per camera (cameras without data included)
    rollup = (
        pl.DataFrame({"camera_code": cameras}, schema={"camera_code": pl.String})
        .join(volume(in_window, ["camera_code"]), on="camera_code", how="left")
        .join(speeds(ends, ["camera_code"]), on="camera_code", how="left")
        .with_columns(
            pl.lit(window_start).alias("bucket_start"),
            pl.lit(window_end).alias("bucket_end"),
            pl.lit(f"{WINDOW_HOURS}h").alias("window_label"),
        )
    )

    def finish(df: pl.DataFrame) -> pl.DataFrame:
        df = df.with_columns(
            pl.col("vehicle_count").fill_null(0), pl.col("plated_count").fill_null(0),
            pl.col("speed_samples").fill_null(0),
        )
        return _bci_columns(df)

    return finish(hourly), finish(rollup)


def od_matrix(legs: pl.DataFrame, window_start: datetime, window_end: datetime) -> pl.DataFrame:
    """Camera-to-camera trips from legs that arrived inside the window."""
    trips = legs.filter(pl.col("valid") & pl.col("arrived_at").is_between(window_start, window_end, closed="left"))
    return (
        trips.group_by(["camera_a", "camera_b"])
        .agg(
            pl.len().cast(pl.Int64).alias("trip_count"),
            pl.col("trajectory_id").n_unique().cast(pl.Int64).alias("unique_vehicles"),
            (pl.col("hours").mean() * 60).alias("avg_travel_minutes"),
            pl.col("speed_kmh").mean().alias("avg_speed_kmh"),
        )
        .rename({"camera_a": "source_camera", "camera_b": "destination_camera"})
        .sort(["trip_count", "source_camera", "destination_camera"], descending=[True, False, False])
    )


# ─── job ─────────────────────────────────────────────────────────────────────

@dataclass
class JobResult:
    engine: str
    window_start: datetime
    window_end: datetime
    rows_read: int
    legs: pl.DataFrame
    hourly: pl.DataFrame
    rollup: pl.DataFrame
    od: pl.DataFrame
    source_counts: dict[str, int] = field(default_factory=dict)
    duration_ms: float = 0.0


def _ts_literal(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00")


def compute(url: Optional[str] = None, now: Optional[datetime] = None, window_hours: int = WINDOW_HOURS,
            engines: tuple[str, ...] = READ_ENGINES) -> JobResult:
    url = url or database_url()
    t0 = time.perf_counter()
    window_end = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    window_start = window_end - timedelta(hours=window_hours)
    # Read slightly before the window so legs that END inside it keep their departure point.
    read_from = window_start - timedelta(hours=2)
    ensure_reachable(url)

    obs, engine = read_frame(
        "SELECT o.id, c.camera_code, o.observed_at, o.confidence, o.integrity_flags, o.trajectory_id, o.source "
        "FROM vehicle_observations o JOIN cameras c ON c.id = o.camera_id "
        f"WHERE o.observed_at >= '{_ts_literal(read_from)}' AND o.observed_at < '{_ts_literal(window_end)}'",
        url, engines,
    )
    meta, _ = read_frame(
        "SELECT (SELECT string_agg(camera_code, ',' ORDER BY camera_code) FROM cameras) AS cameras, "
        "(SELECT string_agg(id, ',') FROM global_trajectories WHERE is_cloned_alert) AS cloned",
        url, engines,
    )
    cameras = (meta["cameras"][0] or "").split(",")
    cloned = set(filter(None, (meta["cloned"][0] or "").split(",")))
    obs = obs.with_columns(pl.col("observed_at").dt.convert_time_zone("UTC"), pl.col("confidence").cast(pl.Float64))

    legs = compute_legs(obs, road_distances(), cloned)
    hourly, rollup = corridor_stats(obs, legs, cameras, window_start, window_end)
    od = od_matrix(legs, window_start, window_end)
    in_window = obs.filter(pl.col("observed_at") >= window_start)
    source_counts = {r["source"]: r["len"] for r in in_window.group_by("source").len().iter_rows(named=True)}
    return JobResult(engine, window_start, window_end, obs.height, legs, hourly, rollup, od, source_counts,
                     (time.perf_counter() - t0) * 1000)


def _clean(v: Any) -> Any:
    """NaN/inf → None so nothing non-finite reaches SQL or JSON."""
    return None if isinstance(v, float) and not math.isfinite(v) else v


def _source_map(struct_counts) -> Optional[dict]:
    if not struct_counts:
        return None
    return {d["source"]["source"]: d["count"] for d in struct_counts}


def write_results(result: JobResult, url: Optional[str] = None) -> dict[str, int]:
    """Upsert corridor_stats / od_matrix; rows from earlier windows are removed in the same transaction."""
    url = url or database_url()
    computed_at = datetime.now(timezone.utc)
    cols = ["camera_code", "window_label", "bucket_start", "bucket_end", "vehicle_count", "plated_count", "ocr_yield",
            "avg_speed_kmh", "speed_samples", "avg_delay_min", "bci_score", "status", "is_severe", "_sources"]
    corridor_rows = [
        tuple(_clean(r[c]) for c in cols[:-1]) + (Jsonb(_source_map(r["_sources"])) if r["_sources"] else None, computed_at)
        for frame in (result.hourly, result.rollup) for r in frame.select(cols).iter_rows(named=True)
    ]
    od_rows = [
        (r["source_camera"], r["destination_camera"], result.window_start, result.window_end, r["trip_count"],
         r["unique_vehicles"], _clean(r["avg_travel_minutes"]), _clean(r["avg_speed_kmh"]), computed_at)
        for r in result.od.iter_rows(named=True)
    ]
    with psycopg.connect(url) as conn, conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO corridor_stats (camera_code, window_label, bucket_start, bucket_end, vehicle_count, plated_count,
                ocr_yield, avg_speed_kmh, speed_samples, avg_delay_min, bci_score, status, is_severe, source_counts, computed_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (camera_code, window_label, bucket_start) DO UPDATE SET
                bucket_end = EXCLUDED.bucket_end, vehicle_count = EXCLUDED.vehicle_count,
                plated_count = EXCLUDED.plated_count, ocr_yield = EXCLUDED.ocr_yield,
                avg_speed_kmh = EXCLUDED.avg_speed_kmh, speed_samples = EXCLUDED.speed_samples,
                avg_delay_min = EXCLUDED.avg_delay_min, bci_score = EXCLUDED.bci_score, status = EXCLUDED.status,
                is_severe = EXCLUDED.is_severe, source_counts = EXCLUDED.source_counts, computed_at = EXCLUDED.computed_at
            """,
            corridor_rows,
        )
        cur.executemany(
            """
            INSERT INTO od_matrix (source_camera, destination_camera, window_start, window_end, trip_count,
                unique_vehicles, avg_travel_minutes, avg_speed_kmh, computed_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (source_camera, destination_camera) DO UPDATE SET
                window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
                trip_count = EXCLUDED.trip_count, unique_vehicles = EXCLUDED.unique_vehicles,
                avg_travel_minutes = EXCLUDED.avg_travel_minutes, avg_speed_kmh = EXCLUDED.avg_speed_kmh,
                computed_at = EXCLUDED.computed_at
            """,
            od_rows,
        )
        # anything not produced by this run belongs to an older window
        cur.execute("DELETE FROM corridor_stats WHERE computed_at < %s", (computed_at,))
        cur.execute("DELETE FROM od_matrix WHERE computed_at < %s", (computed_at,))
    return {"corridor_rows": len(corridor_rows), "od_rows": len(od_rows)}


def run_job(url: Optional[str] = None, now: Optional[datetime] = None) -> dict[str, Any]:
    """compute → write → record the run. Never raises (errors are recorded and returned)."""
    url = url or database_url()
    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    summary: dict[str, Any] = {"started_at": started.isoformat(), "status": "ok"}
    reachable = True
    try:
        try:
            ensure_reachable(url)
        except Exception:
            reachable = False
            raise
        result = compute(url, now)
        written = write_results(result, url)
        summary.update(
            engine=result.engine, rows_read=result.rows_read, legs=int(result.legs.height),
            valid_legs=int(result.legs["valid"].sum()), window_start=result.window_start.isoformat(),
            window_end=result.window_end.isoformat(), source_counts=result.source_counts,
            severe_cameras=result.rollup.filter(pl.col("is_severe"))["camera_code"].to_list(), **written,
        )
    except Exception as exc:
        log.warning("analytics job failed: %s", exc)
        summary.update(status="error", error=f"{type(exc).__name__}: {exc}")
    summary["duration_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    if not reachable:                      # nowhere to record the run
        return summary
    try:
        with psycopg.connect(url, connect_timeout=CONNECT_TIMEOUT_S) as conn:
            conn.execute(
                "INSERT INTO analytics_runs (started_at, finished_at, duration_ms, read_engine, rows_read, legs, status, error, stats) "
                "VALUES (%s, now(), %s, %s, %s, %s, %s, %s, %s)",
                (started, summary["duration_ms"], summary.get("engine"), summary.get("rows_read"), summary.get("legs"),
                 summary["status"], summary.get("error"), Jsonb(summary)),
            )
            conn.execute("DELETE FROM analytics_runs WHERE id < (SELECT max(id) - 500 FROM analytics_runs)")
    except Exception:
        pass
    return summary


def main() -> int:
    import argparse

    p = argparse.ArgumentParser(prog="python -m backend.analytics.polars_jobs", description="Run the Phase 5 analytics once")
    p.add_argument("--database-url")
    args = p.parse_args()
    url = args.database_url or database_url()
    pl.Config.set_tbl_rows(40)
    pl.Config.set_tbl_cols(14)
    pl.Config.set_tbl_width_chars(200)
    res = compute(url)
    print(f"engine={res.engine} rows_read={res.rows_read} legs={res.legs.height} "
          f"valid_legs={int(res.legs['valid'].sum())} window={res.window_start:%Y-%m-%d %H:%M} -> {res.window_end:%H:%M} UTC "
          f"sources={res.source_counts} ({res.duration_ms:.0f} ms)")
    print("\nCorridor rollup (last 24 h):")
    print(res.rollup.select("camera_code", "vehicle_count", "plated_count", "ocr_yield", "avg_speed_kmh",
                            "speed_samples", "avg_delay_min", "bci_score", "status"))
    print("\nO-D matrix (last 24 h):")
    print(res.od)
    print("\nwrite:", write_results(res, url), "->", redact(url))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
