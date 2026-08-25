import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.config import config
from app.db.chat_history_db import delete_chat_history, migrate_user_id, save_chat_history
from app.db.connection import get_conn, init_db
from app.db.manim_artifact_db import create_artifact, get_artifact, list_artifacts_for_chat, update_artifact
from app.main import app
from app.services.manim_policy import validate_scene_source
from app.services.manim_queue import artifact_response, reconcile_artifact, validate_media_token
from app.services.manim_repair import repair_artifact_once
from app.workers.manim_dispatcher import dispatch_manim_artifact
from app.workers.manim_worker import _process_deletion, _recover_running_requests


VALID_SCENE = """from manim import *
import numpy as np

class GeneratedScene(Scene):
    def construct(self):
        dot = Dot(np.array([0, 0, 0]))
        self.play(FadeIn(dot), run_time=1)
"""


class ManimTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.patchers = [
            patch.object(config, "DB_PATH", str(root / "learning.db")),
            patch.object(config, "MANIM_RENDER_DIR", root / "render"),
            patch.object(config, "MANIM_SPOOL_DIR", root / "spool"),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.temp.cleanup)
        config.MANIM_RENDER_DIR.mkdir()
        config.MANIM_SPOOL_DIR.mkdir()
        init_db()

    def create(self, **overrides):
        values = {
            "user_id": "owner", "chat_id": "chat-1", "client_turn_id": "turn-1",
            "title": "向量移动", "rationale": "展示变化", "source_code": VALID_SCENE,
        }
        values.update(overrides)
        return create_artifact(**values)


class PolicyTests(unittest.TestCase):
    def test_valid_scene_is_accepted(self):
        self.assertTrue(validate_scene_source(VALID_SCENE).ok)

    def test_forbidden_import_and_calls_are_rejected(self):
        probes = [
            "import os\nclass GeneratedScene(Scene):\n pass",
            "from manim import *\nclass GeneratedScene(Scene):\n def construct(self): open('/etc/passwd')",
            "from manim import *\nclass GeneratedScene(Scene):\n def construct(self): __builtins__['open']('/etc/passwd')",
            "import numpy as np\nfrom manim import *\nclass GeneratedScene(Scene):\n def construct(self): np.load('/etc/passwd')",
            "import numpy as np\nfrom manim import *\nclass GeneratedScene(Scene):\n def construct(self): np.ctypeslib.load_library('x','/')",
            "from manim import *\nclass GeneratedScene(Scene):\n def construct(self): self.add(ImageMobject('/etc/passwd'))",
        ]
        for source in probes:
            with self.subTest(source=source):
                self.assertFalse(validate_scene_source(source).ok)

    def test_scene_contract_is_enforced(self):
        for source in (
            "from manim import *\nclass Other(Scene): pass",
            "from manim import *\nclass GeneratedScene(MovingCameraScene): pass",
            "from manim import *\nclass GeneratedScene(Scene): pass\nclass Other(Scene): pass",
        ):
            self.assertEqual(validate_scene_source(source).code, "invalid_scene")

    def test_invalid_scene_message_teaches_the_contract(self):
        # 报错文案要把合约讲清楚（直接继承 Scene、无围栏），模型重试时才能改对
        result = validate_scene_source("import manim\nclass GeneratedScene(manim.Scene): pass")
        self.assertEqual(result.code, "invalid_scene")
        self.assertIn("GeneratedScene", result.message)
        self.assertIn("Scene", result.message)


class ArtifactLifecycleTests(ManimTestCase):
    def test_artifact_response_never_exposes_source(self):
        response = artifact_response(self.create())
        self.assertNotIn("source_code", response)
        self.assertNotIn("source_hash", response)
        self.assertEqual(response["client_turn_id"], "turn-1")

    def test_dispatcher_atomically_writes_spool_request(self):
        result = dispatch_manim_artifact("12345678-1234-1234-1234-123456789abc", VALID_SCENE)
        request = Path(result["request_path"])
        self.assertTrue(request.is_file())
        self.assertFalse(list(request.parent.glob("*.tmp")))
        self.assertEqual(json.loads(request.read_text(encoding="utf-8"))["source_code"], VALID_SCENE)

    def test_renderer_recovers_interrupted_request(self):
        running = config.MANIM_SPOOL_DIR / "running"
        pending = config.MANIM_SPOOL_DIR / "pending"
        running.mkdir(parents=True)
        pending.mkdir(parents=True)
        request = running / "12345678-1234-1234-1234-123456789abc.json"
        request.write_text("{}", encoding="utf-8")
        _recover_running_requests()
        self.assertFalse(request.exists())
        self.assertTrue((pending / request.name).is_file())

    def test_result_paths_must_stay_inside_artifact_directory(self):
        artifact = self.create()
        result_dir = config.MANIM_SPOOL_DIR / "results"
        result_dir.mkdir(parents=True)
        result_dir.joinpath(f"{artifact['id']}.json").write_text(json.dumps({
            "artifact_id": artifact["id"], "status": "completed",
            "video_file": "outside.mp4",
        }), encoding="utf-8")
        updated = reconcile_artifact(artifact)
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["error_code"], "missing_output")

    def test_ordinary_render_failure_requests_one_repair(self):
        artifact = self.create()
        result_dir = config.MANIM_SPOOL_DIR / "results"
        result_dir.mkdir(parents=True)
        result_dir.joinpath(f"{artifact['id']}.json").write_text(json.dumps({
            "artifact_id": artifact["id"], "status": "failed",
            "error_code": "render_failed", "error_message": "NameError: bad",
        }), encoding="utf-8")
        updated = reconcile_artifact(artifact)
        self.assertEqual(updated["status"], "repair_pending")
        update_artifact(artifact["id"], status="queued", repair_count=1)
        updated = reconcile_artifact(get_artifact(artifact["id"]))
        self.assertEqual(updated["status"], "failed")

    def test_repair_is_claimed_once_and_requeued(self):
        artifact = self.create()
        update_artifact(artifact["id"], status="repair_pending", error_message="bad")
        response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=VALID_SCENE))])
        with (
            patch("app.services.manim_repair.llm_service.is_available", return_value=True),
            patch("app.services.manim_repair.llm_service.chat", return_value=response) as chat,
            patch("app.services.manim_repair.enqueue_artifact", return_value="job"),
        ):
            repair_artifact_once(artifact["id"])
            repair_artifact_once(artifact["id"])
        updated = get_artifact(artifact["id"])
        self.assertEqual(updated["status"], "queued")
        self.assertEqual(updated["repair_count"], 1)
        self.assertEqual(chat.call_count, 1)

    def test_chat_delete_cleans_artifact_and_files(self):
        chat_id = save_chat_history(user_id="owner", question="q", answer="a")
        artifact = self.create(chat_id=chat_id)
        output = config.MANIM_RENDER_DIR / artifact["id"]
        output.mkdir(parents=True)
        output.joinpath("animation.mp4").write_bytes(b"video")
        self.assertFalse(delete_chat_history(chat_id, "other"))
        self.assertTrue(get_artifact(artifact["id"]))
        self.assertTrue(delete_chat_history(chat_id, "owner"))
        with self.assertRaises(KeyError):
            get_artifact(artifact["id"])
        self.assertFalse(output.exists())
        self.assertTrue((config.MANIM_SPOOL_DIR / "deletions" / f"{artifact['id']}.delete").is_file())
        _process_deletion(config.MANIM_SPOOL_DIR / "deletions" / f"{artifact['id']}.delete")
        self.assertTrue((config.MANIM_SPOOL_DIR / "deleted" / f"{artifact['id']}.tombstone").is_file())

    def test_migration_moves_artifact_owner(self):
        self.create(user_id="anonymous")
        migrate_user_id("anonymous", "registered")
        self.assertEqual(len(list_artifacts_for_chat("chat-1", "registered")), 1)


class ArtifactApiTests(ManimTestCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.owner_token = create_access_token({"user_id": "owner"})
        self.other_token = create_access_token({"user_id": "other"})

    def test_status_and_list_enforce_ownership(self):
        artifact = self.create()
        owner = self.client.get(
            f"/api/manim/artifacts/{artifact['id']}", headers={"Authorization": f"Bearer {self.owner_token}"},
        )
        other = self.client.get(
            f"/api/manim/artifacts/{artifact['id']}", headers={"Authorization": f"Bearer {self.other_token}"},
        )
        listing = self.client.get(
            "/api/manim/artifacts?chat_id=chat-1", headers={"Authorization": f"Bearer {self.owner_token}"},
        )
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(other.status_code, 404)
        self.assertEqual(len(listing.json()), 1)

    def test_media_token_rejects_tampering(self):
        artifact = self.create()
        response = artifact_response(artifact)
        token = response["video_url"] if response.get("video_url") else None
        self.assertIsNone(token)
        from app.services.manim_queue import _media_token
        valid = _media_token(artifact["id"], "owner", ttl_seconds=60)
        self.assertEqual(validate_media_token(artifact["id"], valid), "owner")
        self.assertIsNone(validate_media_token(artifact["id"], valid + "x"))
        expired = _media_token(artifact["id"], "owner", ttl_seconds=-1)
        self.assertIsNone(validate_media_token(artifact["id"], expired))


class ReconcileOrphanTests(ManimTestCase):
    """僵尸 artifact 对账：RQ job 丢失（Redis 重启）或投递从未发生时必须判失败。

    否则记录永久滞留 queued 并被 MANIM_MAX_QUEUE 计数，堵死后续所有渲染
    （2026-08-26 本地部署实测复现：2 条 8-24 的僵尸任务 + 队列名额占满）。
    """

    def test_lost_rq_job_marks_failed(self):
        from rq.exceptions import NoSuchJobError

        artifact = update_artifact(self.create()["id"], rq_job_id="gone-job")
        with patch("rq.job.Job.fetch", side_effect=NoSuchJobError("gone")):
            updated = reconcile_artifact(get_artifact(artifact["id"]))
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["error_code"], "dispatch_failed")

    def test_failed_rq_job_marks_failed_with_detail(self):
        artifact = update_artifact(self.create()["id"], rq_job_id="bad-job")
        fake_job = SimpleNamespace(
            get_status=lambda refresh=True: "failed",
            exc_info="Traceback...\nValueError: invalid_scene: boom",
        )
        with patch("rq.job.Job.fetch", return_value=fake_job):
            updated = reconcile_artifact(get_artifact(artifact["id"]))
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["error_code"], "dispatch_failed")
        self.assertIn("boom", updated["error_message"])

    def test_missing_rq_job_id_within_grace_stays_queued(self):
        # rq_job_id 为空但刚创建（60s 投递宽限期内）→ 不得误判
        artifact = self.create()
        self.assertEqual(reconcile_artifact(artifact)["status"], "queued")

    def test_missing_rq_job_id_beyond_grace_marks_failed(self):
        artifact = self.create()
        conn = get_conn()
        try:
            conn.execute(
                "UPDATE manim_artifacts SET created_at=? WHERE id=?",
                ("2020-01-01 00:00:00", artifact["id"]),
            )
            conn.commit()
        finally:
            conn.close()
        updated = reconcile_artifact(get_artifact(artifact["id"]))
        self.assertEqual(updated["status"], "failed")
        self.assertEqual(updated["error_code"], "dispatch_failed")


if __name__ == "__main__":
    unittest.main()
