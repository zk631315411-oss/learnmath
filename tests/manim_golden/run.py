"""Run the Manim golden set inside the production renderer image."""
from __future__ import annotations

import json
import statistics
import time

from cases import CASES
from app.config import config
from app.workers.manim_dispatcher import dispatch_manim_artifact
from app.workers.manim_worker import run_spool_worker


results = []
for index, (name, source) in enumerate(CASES, start=1):
    started = time.perf_counter()
    try:
        artifact_id = f"00000000-0000-0000-0000-{index:012d}"
        dispatch_manim_artifact(artifact_id, source, 12, "low")
        run_spool_worker(once=True)
        result_path = config.MANIM_SPOOL_DIR / "results" / f"{artifact_id}.json"
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if result.get("status") != "completed":
            raise RuntimeError(result.get("error_message") or result.get("error_code") or "render failed")
        paths = {"video_file": result["video_file"], "poster_file": result.get("poster_file") or ""}
        elapsed = time.perf_counter() - started
        results.append({"name": name, "ok": True, "seconds": round(elapsed, 3), **paths})
    except Exception as exc:
        elapsed = time.perf_counter() - started
        results.append({"name": name, "ok": False, "seconds": round(elapsed, 3), "error": str(exc)[-500:]})

times = sorted(item["seconds"] for item in results)
p95_index = max(0, min(len(times) - 1, int(0.95 * len(times) + 0.9999) - 1))
report = {
    "successes": sum(1 for item in results if item["ok"]),
    "total": len(results),
    "p95_seconds": times[p95_index],
    "median_seconds": round(statistics.median(times), 3),
    "results": results,
}
print("GOLDEN_REPORT=" + json.dumps(report, ensure_ascii=False))
raise SystemExit(0 if report["successes"] >= 8 and report["p95_seconds"] <= 90 else 1)
