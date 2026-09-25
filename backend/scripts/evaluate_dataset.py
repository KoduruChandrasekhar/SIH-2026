#!/usr/bin/env python3
"""
TraceNet — score the pipeline against the synthetic dataset's ground truth (completion plan 4C).

    python backend/scripts/generate_dataset.py          # once
    python backend/scripts/evaluate_dataset.py          # fusion: ground-truth sightings + Re-ID from the crops
    python backend/scripts/evaluate_dataset.py --e2e    # vision too: YOLO11 + ByteTrack + ANPR on the videos

Fusion mode feeds the Phase 3 engine exactly what a perfect camera would report (plate text only where the
plate was printed legibly, INVALID_FORMAT for tampered plates, nothing for glare) with appearance embeddings
from the rendered vehicle crops. It isolates the identity/physics logic.

End-to-end mode runs the real Phase 1 + Phase 2 stack on every camera video, maps each observation back to
wall time through the recording segments, matches it to a ground-truth transit (same camera, overlapping in
time, same lane), then fuses the observations - so it measures detection, plate reading and fusion together.

Metrics
    identity   pairwise precision / recall / F1 over sightings (same vehicle ⇔ same Global Vehicle ID);
               the clone pair is excluded (two vehicles sharing a plate are linked by design and flagged)
    ghost      plate-less transits linked to their vehicle's trajectory
    alerts     CLONED_PLATE / BLACKLIST_HIT / INVALID_FORMAT found vs expected, plus false alerts
    vision     (e2e) transit detection recall, plate read rate, plate precision, false plate reads
Report: backend/output/dataset/evaluation[_e2e].json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from itertools import combinations
from pathlib import Path
from typing import Any, Optional

import cv2

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.fusion.config import load_fusion_config  # noqa: E402
from backend.fusion.fusion_engine import FusionEngine  # noqa: E402
from backend.fusion.models import IntegrityFlag, Sighting, parse_timestamp  # noqa: E402
from backend.fusion.redis_state import create_state  # noqa: E402
from backend.fusion.reid_matcher import create_reid_extractor  # noqa: E402
from backend.fusion.road_network import RoadNetwork  # noqa: E402

DATASET_DIR = PROJECT_ROOT / "backend" / "output" / "dataset"
EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)       # ANPR clock origin → timestamp - EPOCH = video offset
DEFAULT_WATCHLIST = {"DL01XY0001"}


# ─── helpers ─────────────────────────────────────────────────────────────────

def load_gt(dataset: Path) -> dict[str, Any]:
    path = dataset / "ground_truth.json"
    if not path.exists():
        raise SystemExit(f"[ERROR] {path} not found - run: python backend/scripts/generate_dataset.py")
    return json.loads(path.read_text(encoding="utf-8"))


def watchlist() -> tuple[set[str], str]:
    try:
        from backend.alerts.watchlist import WatchlistCache
        from backend.db.config import database_url

        entries = WatchlistCache(database_url()).entries()
        return {e["plate"] for e in entries} | set(), "postgis"
    except Exception:
        return set(DEFAULT_WATCHLIST), "seed default"


def video_to_wall(segments: list[dict[str, Any]], offset: float) -> Optional[datetime]:
    for seg in segments:
        if seg["video_start"] - 0.05 <= offset <= seg["video_end"] + 0.05:
            return datetime.fromisoformat(seg["wall_start"]) + timedelta(seconds=offset - seg["video_start"])
    return None


def fuse(sightings: list[Sighting], wl: set[str]) -> dict[str, dict[str, Any]]:
    """Run the Phase 3 engine in memory; per sighting: global id, link type, alerts it produced."""
    cfg = load_fusion_config()
    engine = FusionEngine(cfg, create_state(cfg.redis_url, cfg.active_window_seconds, use_redis=False),
                          RoadNetwork(), None, source="dataset")
    out: dict[str, dict[str, Any]] = {}
    for s in sorted(sightings, key=lambda x: x.timestamp):
        d = engine.process(s)
        traj = engine.state.get_trajectory(d.global_vehicle_id) or {}
        alerts = [a.to_dict() for a in d.alerts]
        for plate in dict.fromkeys(p for p in (s.plate_text, traj.get("canonical_plate")) if p):
            if plate in wl:
                alerts.append({"alert_type": "BLACKLIST_HIT", "plate_number": plate})
                break
        if s.integrity_flag in (IntegrityFlag.INVALID_FORMAT, IntegrityFlag.TAMPERED_PHYSICAL):
            alerts.append({"alert_type": "INVALID_FORMAT", "plate_number": s.meta.get("raw_text")})
        out[s.sighting_id] = {"gid": d.global_vehicle_id, "link": d.to_dict().get("link"), "alerts": alerts,
                              "camera_id": s.camera_id}
    return out


def identity_metrics(assign: dict[str, str], fused: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """assign: sighting_id → ground-truth vehicle id (only sightings to score)."""
    ids = [sid for sid in assign if sid in fused]
    tp = fp = fn = 0
    for a, b in combinations(ids, 2):
        same_gt = assign[a] == assign[b]
        same_pred = fused[a]["gid"] == fused[b]["gid"]
        tp += same_gt and same_pred
        fp += (not same_gt) and same_pred
        fn += same_gt and not same_pred
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    per_vehicle = defaultdict(set)
    per_pred = defaultdict(set)
    for sid in ids:
        per_vehicle[assign[sid]].add(fused[sid]["gid"])
        per_pred[fused[sid]["gid"]].add(assign[sid])
    return {"sightings": len(ids), "pairs_tp": tp, "pairs_fp": fp, "pairs_fn": fn,
            "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
            "vehicles": len(per_vehicle),
            "vehicles_single_id": sum(1 for g in per_vehicle.values() if len(g) == 1),
            "fragmented_vehicles": sorted(v for v, g in per_vehicle.items() if len(g) > 1),
            "merged_ids": sum(1 for v in per_pred.values() if len(v) > 1)}


def alert_metrics(gt: dict[str, Any], fused: dict[str, dict[str, Any]], transit_of: dict[str, str]) -> dict[str, Any]:
    expected = gt["expected_alerts"]
    found = Counter()
    plates = defaultdict(set)
    invalid_transits = set()
    for sid, f in fused.items():
        for a in f["alerts"]:
            found[a["alert_type"]] += 1
            plates[a["alert_type"]].add(a.get("plate_number"))
            if a["alert_type"] == "INVALID_FORMAT" and sid in transit_of:
                invalid_transits.add(transit_of[sid])
    exp_invalid = set(expected["INVALID_FORMAT"])
    return {
        "CLONED_PLATE": {"expected": expected["CLONED_PLATE"], "found": sorted(p for p in plates["CLONED_PLATE"] if p),
                         "detected": all(p in plates["CLONED_PLATE"] for p in expected["CLONED_PLATE"]),
                         "false": sorted(p for p in plates["CLONED_PLATE"] if p and p not in expected["CLONED_PLATE"])},
        "BLACKLIST_HIT": {"expected": expected["BLACKLIST_HIT"], "hits": found["BLACKLIST_HIT"],
                          "detected": all(p in plates["BLACKLIST_HIT"] for p in expected["BLACKLIST_HIT"]),
                          "false": sorted(p for p in plates["BLACKLIST_HIT"] if p and p not in expected["BLACKLIST_HIT"])},
        "INVALID_FORMAT": {"expected_transits": sorted(exp_invalid), "found_transits": sorted(invalid_transits & exp_invalid),
                           "recall": round(len(invalid_transits & exp_invalid) / len(exp_invalid), 4) if exp_invalid else 1.0,
                           "alerts_total": found["INVALID_FORMAT"],
                           "on_other_transits": len(invalid_transits - exp_invalid)},
    }


def ghost_metrics(gt: dict[str, Any], fused: dict[str, dict[str, Any]], sighting_of: dict[str, str]) -> dict[str, Any]:
    """Glare transits (no readable plate): linked to the ID that the vehicle's clean transits got?"""
    by_vehicle = defaultdict(list)
    for t in gt["transits"]:
        sid = sighting_of.get(t["transit_id"])
        if sid in fused:
            by_vehicle[t["vehicle_id"]].append((t, fused[sid]["gid"]))
    total = linked = 0
    for vid, rows in by_vehicle.items():
        clean_ids = Counter(g for t, g in rows if t["plate_condition"] == "clean")
        if not clean_ids:
            continue
        home = clean_ids.most_common(1)[0][0]
        for t, g in rows:
            if t["plate_condition"] == "glare":
                total += 1
                linked += g == home
    return {"plate_less_transits": total, "linked_to_vehicle": linked,
            "rate": round(linked / total, 4) if total else None}


# ─── fusion-only ─────────────────────────────────────────────────────────────

def gt_sightings(gt: dict[str, Any], dataset: Path) -> tuple[list[Sighting], dict[str, str]]:
    reid = create_reid_extractor(load_fusion_config().reid_weights_path)
    sightings, transit_of = [], {}
    for t in gt["transits"]:
        crop = cv2.imread(str(dataset / t["crop"]))
        clean = t["plate_condition"] == "clean"
        sid = f"gt:{t['transit_id']}"
        sightings.append(Sighting(
            sighting_id=sid, camera_id=t["camera_id"], timestamp=parse_timestamp(t["timestamp"]),
            plate_text=t["expected_plate"] or "", ocr_confidence=0.93 if clean else 0.0,
            appearance_embedding=reid.extract_embedding(crop) if crop is not None else None,
            vehicle_bbox=t["bbox"], integrity_flag=IntegrityFlag(t["expected_flag"]),
            first_seen=parse_timestamp(t["window"][0]), last_seen=parse_timestamp(t["window"][1]),
            source="dataset", meta={"raw_text": t["plate_printed"]} if t["expected_flag"] == "INVALID_FORMAT" else {}))
        transit_of[sid] = t["transit_id"]
    return sightings, transit_of


def evaluate_fusion(dataset: Path = DATASET_DIR) -> dict[str, Any]:
    gt = load_gt(dataset)
    wl, wl_source = watchlist()
    sightings, transit_of = gt_sightings(gt, dataset)
    fused = fuse(sightings, wl)
    return _report("fusion", gt, fused, transit_of, wl_source)


def _report(mode: str, gt: dict[str, Any], fused: dict[str, dict[str, Any]], transit_of: dict[str, str],
            wl_source: str, vision: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    roles = {v["vehicle_id"]: v["role"] for v in gt["vehicles"]}
    vehicle_of_transit = {t["transit_id"]: t["vehicle_id"] for t in gt["transits"]}
    assign = {sid: vehicle_of_transit[tid] for sid, tid in transit_of.items()
              if roles[vehicle_of_transit[tid]] not in ("clone_a", "clone_b")}
    sighting_of = {tid: sid for sid, tid in transit_of.items()}
    report = {
        "mode": mode, "dataset": gt["dataset"], "seed": gt["seed"],
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "ground_truth": {"vehicles": len(gt["vehicles"]), "transits": len(gt["transits"]),
                         "roles": dict(Counter(roles.values()))},
        "identity": identity_metrics(assign, fused),
        "ghost": ghost_metrics(gt, fused, sighting_of),
        "alerts": alert_metrics(gt, fused, transit_of),
        "links": dict(Counter(f["link"] for f in fused.values())),
        "watchlist_source": wl_source,
    }
    if vision is not None:
        report["vision"] = vision
    return report


# ─── end-to-end ──────────────────────────────────────────────────────────────

def run_camera(video: Path, camera_id: str, work_dir: Path, model: str = "yolo11n.pt") -> list[tuple[dict, Any]]:
    """YOLO11 + ByteTrack + ANPR over one video; returns (observation dict, best vehicle crop) per transit."""
    from backend.ai.vehicle_tracker import VehicleTracker
    from backend.anpr import ANPRPipeline

    tracker = VehicleTracker(model_path=model, output_dir=str(work_dir), public_dir=str(work_dir))
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.release()
    collected: list[tuple[dict, Any]] = []
    pipeline = ANPRPipeline(camera_id, fps=fps, start_time=EPOCH, video_name=video.name,
                            output_root=str(work_dir / "anpr"),
                            observation_sink=lambda obs, crop: collected.append((obs.to_dict(), crop)))
    tracker.process_video(str(video), camera_id=camera_id, write_video=False,
                          frame_callback=lambda i, ts, frame, dets: pipeline.process_frame(i, frame, dets, media_offset=ts))
    pipeline.finish(save=False)
    return collected


def evaluate_e2e(dataset: Path = DATASET_DIR, cameras: Optional[list[str]] = None, log=print) -> dict[str, Any]:
    from backend.fusion.sources import sighting_from_observation

    gt = load_gt(dataset)
    wl, wl_source = watchlist()
    reid = create_reid_extractor(load_fusion_config().reid_weights_path)
    W = gt["resolution"][0]
    work = dataset / "eval_work"
    work.mkdir(parents=True, exist_ok=True)
    sightings, transit_of = [], {}
    matched_obs: dict[str, dict] = {}
    unmatched = 0
    for cam, info in sorted(gt["cameras"].items()):
        if not info["video"] or (cameras and cam not in cameras):
            continue
        log(f"  {cam}: YOLO11 + ByteTrack + ANPR ...")
        obs_list = run_camera(dataset / info["video"], cam, work)
        cam_gt = [t for t in gt["transits"] if t["camera_id"] == cam]
        candidates = []
        for obs, crop in obs_list:
            start = video_to_wall(info["segments"], (parse_timestamp(obs["first_seen"]) - EPOCH).total_seconds())
            end = video_to_wall(info["segments"], (parse_timestamp(obs["last_seen"]) - EPOCH).total_seconds())
            best = video_to_wall(info["segments"], (parse_timestamp(obs["timestamp"]) - EPOCH).total_seconds())
            if start is None or end is None or best is None:
                continue
            obs = {**obs, "timestamp": best.isoformat(), "first_seen": start.isoformat(), "last_seen": end.isoformat()}
            bx = obs.get("vehicle_bbox") or [0, 0, 0, 0]
            cx = (bx[0] + bx[2]) / 2
            for t in cam_gt:
                w0, w1 = parse_timestamp(t["window"][0]), parse_timestamp(t["window"][1])
                overlap = (min(end, w1) - max(start, w0)).total_seconds()
                if overlap > 0 and abs(cx - t["lane"] * W) < 0.15 * W:
                    candidates.append((overlap, obs["observation_id"], t["transit_id"]))
            s = sighting_from_observation(obs, cam, reid.extract_embedding(crop) if crop is not None else None,
                                          reid.name, source="dataset")
            sightings.append(s)
            matched_obs[obs["observation_id"]] = obs
        used_obs, used_tr = set(), set()
        for overlap, oid, tid in sorted(candidates, reverse=True):          # greedy one-to-one by overlap
            if oid in used_obs or tid in used_tr:
                continue
            used_obs.add(oid)
            used_tr.add(tid)
            transit_of[oid] = tid
        unmatched += len(obs_list) - len(used_obs)
        log(f"      {len(obs_list)} observations, {len(used_tr)}/{len(cam_gt)} ground-truth transits matched")

    fused = fuse(sightings, wl)
    gt_by_id = {t["transit_id"]: t for t in gt["transits"]}
    scored = [t for t in gt["transits"] if not cameras or t["camera_id"] in cameras]
    obs_of = {tid: matched_obs[oid] for oid, tid in transit_of.items()}
    clean = [t for t in scored if t["plate_condition"] == "clean"]
    read = [t for t in clean if obs_of.get(t["transit_id"], {}).get("plate_status") == "DETECTED"]
    exact = [t for t in read if obs_of[t["transit_id"]]["plate"] == t["expected_plate"]]
    glare = [t for t in scored if t["plate_condition"] == "glare" and t["transit_id"] in obs_of]
    tampered = [t for t in scored if t["plate_condition"] == "tampered" and t["transit_id"] in obs_of]
    vision = {
        "transits": len(scored), "detected_transits": len(obs_of),
        "detection_recall": round(len(obs_of) / len(scored), 4) if scored else None,
        "unmatched_observations": unmatched,
        "clean_plates": len(clean), "plates_read": len(read), "plates_exact": len(exact),
        "plate_read_rate": round(len(read) / len(clean), 4) if clean else None,
        "plate_accuracy_on_all_clean": round(len(exact) / len(clean), 4) if clean else None,
        "plate_precision": round(len(exact) / len(read), 4) if read else None,
        "misreads": [{"transit": t["transit_id"], "expected": t["expected_plate"], "read": obs_of[t["transit_id"]]["plate"]}
                     for t in read if t not in exact],
        "glare_transits_read_as_plate": sum(1 for t in glare if obs_of[t["transit_id"]].get("plate_status") == "DETECTED"),
        "tampered_flagged_invalid": sum(1 for t in tampered if obs_of[t["transit_id"]].get("plate_status") == "INVALID_FORMAT"),
        "tampered_detected": len(tampered),
        "status_counts": dict(Counter(o.get("plate_status") for o in matched_obs.values())),
    }
    del gt_by_id
    return _report("e2e", gt, fused, transit_of, wl_source, vision)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def print_report(r: dict[str, Any]) -> None:
    idm, gh, al = r["identity"], r["ghost"], r["alerts"]
    print("=" * 72)
    print(f"  TraceNet evaluation - {r['mode']} | {r['dataset']} (seed {r['seed']})")
    print("=" * 72)
    print(f"  ground truth     : {r['ground_truth']['vehicles']} vehicles, {r['ground_truth']['transits']} transits {r['ground_truth']['roles']}")
    if "vision" in r:
        v = r["vision"]
        print(f"  detection        : {v['detected_transits']}/{v['transits']} transits (recall {v['detection_recall']}), "
              f"{v['unmatched_observations']} unmatched observations")
        print(f"  plates           : read {v['plates_read']}/{v['clean_plates']} (rate {v['plate_read_rate']}), "
              f"exact {v['plates_exact']} (precision {v['plate_precision']}, accuracy {v['plate_accuracy_on_all_clean']})")
        print(f"  glare read as plate: {v['glare_transits_read_as_plate']} | tampered flagged INVALID_FORMAT: "
              f"{v['tampered_flagged_invalid']}/{v['tampered_detected']}")
    print(f"  identity (pairs) : precision {idm['precision']} | recall {idm['recall']} | F1 {idm['f1']}  "
          f"({idm['vehicles_single_id']}/{idm['vehicles']} vehicles with one ID, {idm['merged_ids']} merged IDs)")
    print(f"  ghost links      : {gh['linked_to_vehicle']}/{gh['plate_less_transits']} plate-less transits (rate {gh['rate']})")
    print(f"  CLONED_PLATE     : detected={al['CLONED_PLATE']['detected']} {al['CLONED_PLATE']['found']} false={al['CLONED_PLATE']['false']}")
    print(f"  BLACKLIST_HIT    : detected={al['BLACKLIST_HIT']['detected']} hits={al['BLACKLIST_HIT']['hits']} false={al['BLACKLIST_HIT']['false']}")
    print(f"  INVALID_FORMAT   : recall {al['INVALID_FORMAT']['recall']} ({len(al['INVALID_FORMAT']['found_transits'])}/"
          f"{len(al['INVALID_FORMAT']['expected_transits'])}), on other transits {al['INVALID_FORMAT']['on_other_transits']}")
    print(f"  link types       : {r['links']}")
    print("=" * 72)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Evaluate TraceNet on the synthetic dataset (plan 4C)")
    p.add_argument("--dataset", default=str(DATASET_DIR))
    p.add_argument("--e2e", action="store_true", help="also run YOLO11 + ANPR on the videos (slow on CPU)")
    p.add_argument("--camera", action="append", help="--e2e: limit to these cameras")
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)
    import logging

    logging.basicConfig(level=logging.WARNING, format="[%(name)s] %(message)s")
    dataset = Path(args.dataset)
    report = evaluate_e2e(dataset, args.camera) if args.e2e else evaluate_fusion(dataset)
    out = dataset / f"evaluation{'_e2e' if args.e2e else ''}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2)) if args.json else print_report(report)
    print(f"  report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
