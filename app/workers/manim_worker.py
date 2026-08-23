"""Network-free renderer that consumes trusted file-spool requests."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from app.config import config
from app.services.manim_policy import validate_scene_source


def render_manim_artifact(
    artifact_id: str,
    source_code: str,
    duration_seconds: float = 12,
    quality: str = "low",
) -> dict[str, str]:
    """Render one already-dispatched request without network or business data access."""
    policy = validate_scene_source(source_code, max_bytes=config.MANIM_MAX_SOURCE_BYTES)
    if not policy.ok:
        raise ValueError(policy.message)
    if not 1 <= float(duration_seconds) <= config.MANIM_MAX_DURATION_SECONDS:
        raise ValueError("动画时长不符合限制")
    quality_flag = {"low": "-ql", "medium": "-qm"}.get(quality)
    if quality_flag is None:
        raise ValueError("动画质量不符合限制")

    with tempfile.TemporaryDirectory(prefix="learnmath-manim-") as temp:
        workdir = Path(temp)
        source = workdir / "scene.py"
        media = workdir / "media"
        source.write_text(source_code, encoding="utf-8")
        media.mkdir()
        command = [
            "manim", "render", quality_flag, "--format", "mp4", "--disable_caching",
            "--media_dir", str(media), str(source), "GeneratedScene",
        ]
        try:
            completed = subprocess.run(
                command,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=max(1, config.MANIM_RENDER_TIMEOUT_SECONDS - 5),
                check=False,
                env=_minimal_environment(),
            )
        except subprocess.TimeoutExpired as exc:
            raise RenderFailure("timeout", "动画渲染超时") from exc
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "Manim 渲染失败").strip()[-2000:]
            raise RenderFailure("render_failed", detail)

        movies = list(media.rglob("*.mp4"))
        if not movies:
            raise RenderFailure("missing_output", "Manim 未生成 MP4")
        movie = movies[0]
        if movie.stat().st_size > config.MANIM_MAX_OUTPUT_BYTES:
            raise RenderFailure("output_too_large", "动画文件超过大小限制")
        duration = _video_duration(movie)
        if duration is None:
            raise RenderFailure("duration_unreadable", "无法读取动画时长")
        # 模型声明的 duration_seconds 只是预估值，常与实际渲染不符；真正要守住的是
        # 系统硬上限 MANIM_MAX_DURATION_SECONDS。超出自报值但在硬上限内的视频仍可交付。
        if duration > config.MANIM_MAX_DURATION_SECONDS + 0.25:
            raise RenderFailure(
                "duration_exceeded",
                f"动画实际时长 {duration:.1f} 秒，超过上限 {config.MANIM_MAX_DURATION_SECONDS:.0f} 秒",
            )

        target_dir = config.MANIM_RENDER_DIR / artifact_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target_movie = target_dir / "animation.mp4"
        shutil.copy2(movie, target_movie)
        poster = target_dir / "poster.png"
        _extract_representative_frame(target_movie, poster)
        return {
            "video_file": target_movie.name,
            "poster_file": poster.name if poster.is_file() and poster.stat().st_size else "",
        }


class RenderFailure(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def run_spool_worker(*, once: bool = False) -> None:
    for name in ("pending", "running", "results", "deletions", "deleted"):
        (config.MANIM_SPOOL_DIR / name).mkdir(parents=True, exist_ok=True)
    _recover_running_requests()
    while True:
        deletion = _next_deletion()
        if deletion is not None:
            _process_deletion(deletion)
            if once:
                return
            continue
        request = _claim_next_request()
        if request is None:
            if once:
                return
            time.sleep(config.MANIM_RENDER_POLL_SECONDS)
            continue
        _process_request(request)
        if once:
            return


def _claim_next_request() -> Path | None:
    pending = config.MANIM_SPOOL_DIR / "pending"
    running = config.MANIM_SPOOL_DIR / "running"
    for candidate in sorted(pending.glob("*.json"), key=lambda item: item.stat().st_mtime):
        if (
            (config.MANIM_SPOOL_DIR / "deletions" / f"{candidate.stem}.delete").is_file()
            or (config.MANIM_SPOOL_DIR / "deleted" / f"{candidate.stem}.tombstone").is_file()
        ):
            candidate.unlink(missing_ok=True)
            continue
        target = running / candidate.name
        try:
            candidate.replace(target)
            return target
        except (FileNotFoundError, OSError):
            continue
    return None


def _recover_running_requests() -> None:
    pending = config.MANIM_SPOOL_DIR / "pending"
    running = config.MANIM_SPOOL_DIR / "running"
    for request in running.glob("*.json"):
        target = pending / request.name
        if target.exists():
            request.unlink(missing_ok=True)
        else:
            request.replace(target)


def _next_deletion() -> Path | None:
    for candidate in (config.MANIM_SPOOL_DIR / "deletions").glob("*.delete"):
        return candidate
    return None


def _process_deletion(marker: Path) -> None:
    artifact_id = marker.stem
    output = (config.MANIM_RENDER_DIR / artifact_id).resolve()
    if output.parent == config.MANIM_RENDER_DIR.resolve() and output.is_dir():
        shutil.rmtree(output)
    result = config.MANIM_SPOOL_DIR / "results" / f"{artifact_id}.json"
    try:
        result.unlink()
    except FileNotFoundError:
        pass
    for folder in ("pending", "running"):
        (config.MANIM_SPOOL_DIR / folder / f"{artifact_id}.json").unlink(missing_ok=True)
    deleted = config.MANIM_SPOOL_DIR / "deleted"
    deleted.mkdir(parents=True, exist_ok=True)
    (deleted / f"{artifact_id}.tombstone").touch(exist_ok=True)
    marker.unlink(missing_ok=True)


def _process_request(request_path: Path) -> None:
    """Run each untrusted scene in a fresh process and enforce total wall time."""
    command = [sys.executable, "-m", "app.workers.manim_worker", "--render-request", str(request_path)]
    try:
        completed = subprocess.run(
            command,
            cwd=config.BASE_DIR,
            capture_output=True,
            text=True,
            timeout=config.MANIM_RENDER_TIMEOUT_SECONDS,
            check=False,
            env=_minimal_environment(),
        )
        if completed.returncode == 0:
            return
        detail = (completed.stderr or completed.stdout or "渲染子进程失败").strip()[-500:]
        _write_result(request_path.stem, {
            "artifact_id": request_path.stem,
            "status": "failed",
            "error_code": "renderer_error",
            "error_message": detail,
        })
    except subprocess.TimeoutExpired:
        _write_result(request_path.stem, {
            "artifact_id": request_path.stem,
            "status": "failed",
            "error_code": "timeout",
            "error_message": "动画渲染超时",
        })
    finally:
        request_path.unlink(missing_ok=True)


def _render_claimed_request(request_path: Path) -> None:
    artifact_id = request_path.stem
    result: dict[str, object] = {"artifact_id": artifact_id}
    try:
        if request_path.stat().st_size > config.MANIM_MAX_SOURCE_BYTES + 4096:
            raise RenderFailure("invalid_request", "渲染任务超过大小限制")
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("artifact_id") != artifact_id:
            raise RenderFailure("invalid_request", "渲染任务无效")
        paths = render_manim_artifact(
            artifact_id,
            str(payload.get("source_code") or ""),
            float(payload.get("duration_seconds") or 12),
            str(payload.get("quality") or "low"),
        )
        result.update({"status": "completed", **paths})
    except RenderFailure as exc:
        result.update({"status": "failed", "error_code": exc.code, "error_message": str(exc)[-500:]})
    except Exception as exc:
        result.update({"status": "failed", "error_code": "renderer_error", "error_message": str(exc)[-500:]})
    finally:
        _write_result(artifact_id, result)


def _write_result(artifact_id: str, result: dict[str, object]) -> None:
    results = config.MANIM_SPOOL_DIR / "results"
    results.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=results, prefix=f".{artifact_id}-", suffix=".tmp", delete=False,
    ) as handle:
        json.dump(result, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    temporary.replace(results / f"{artifact_id}.json")


def _video_duration(movie: Path) -> float | None:
    try:
        import av
        with av.open(str(movie)) as container:
            stream = next(item for item in container.streams if item.type == "video")
            if stream.duration is None or stream.time_base is None:
                return float(container.duration / 1_000_000) if container.duration else None
            return float(stream.duration * stream.time_base)
    except Exception:
        return None


def _extract_representative_frame(movie: Path, poster: Path) -> None:
    try:
        import av
        from PIL import ImageStat
        with av.open(str(movie)) as container:
            stream = next(item for item in container.streams if item.type == "video")
            best_image = None
            best_variance = -1.0
            for frame in container.decode(stream):
                image = frame.to_image().convert("RGB")
                variance = float(ImageStat.Stat(image.convert("L")).var[0])
                if variance > best_variance:
                    best_image = image.copy()
                    best_variance = variance
            if best_image is not None:
                best_image.save(poster, format="PNG")
    except Exception:
        pass


def _minimal_environment() -> dict[str, str]:
    allowed = {
        "PATH", "LANG", "LC_ALL", "TZ", "HOME", "TMPDIR", "PYTHONPATH",
        "MANIM_SPOOL_DIR", "MANIM_RENDER_DIR", "MANIM_MAX_SOURCE_BYTES",
        "MANIM_MAX_DURATION_SECONDS", "MANIM_RENDER_TIMEOUT_SECONDS", "MANIM_MAX_OUTPUT_BYTES",
    }
    environment = {key: value for key, value in os.environ.items() if key in allowed}
    environment.update({"PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"})
    return environment


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--render-request", type=Path)
    args = parser.parse_args()
    if args.render_request:
        _render_claimed_request(args.render_request)
        return
    run_spool_worker(once=args.once)


if __name__ == "__main__":
    main()
