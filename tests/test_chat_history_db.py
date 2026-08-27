import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.auth.jwt_handler import create_access_token
from app.config import config
from app.db.chat_history_db import get_chat_history, migrate_user_id, save_chat_history, update_chat_answer
from app.db.evidence_db import insert_evidence_rows, list_evidence_for_user
from app.db.connection import get_conn, init_db
from app.db.learner_model_db import compute_node_estimate
from app.main import app


class ChatHistoryTests(unittest.TestCase):
    def test_follow_ups_and_tool_activity_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = str(Path(temp_dir) / "learning.db")
            with patch.object(config, "DB_PATH", db_path):
                init_db()
                chat_id = save_chat_history(
                    user_id="student",
                    question="什么是特征值？",
                    answer="先说说你的思路。",
                    tool_activities=json.dumps([{"tool": "retrieve_kg_context"}]),
                )
                follow_ups = [{
                    "question": "为什么？",
                    "answer": "我们从矩阵对向量的作用看。",
                    "thinking": "承接上一轮",
                    "tool_activities": [],
                }]
                update_chat_answer(chat_id, follow_ups=json.dumps(follow_ups, ensure_ascii=False))

                rows = get_chat_history("student", chat_id=chat_id)

        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["follow_ups"]), follow_ups)
        self.assertEqual(
            json.loads(rows[0]["tool_activities"])[0]["tool"],
            "retrieve_kg_context",
        )

    def test_exact_chat_lookup_requires_matching_user(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                chat_id = save_chat_history(user_id="owner", question="q", answer="a")
                self.assertEqual(len(get_chat_history("owner", chat_id=chat_id)), 1)
                self.assertEqual(get_chat_history("other", chat_id=chat_id), [])

    def test_migrate_user_id_moves_chat_and_evidence_together(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                save_chat_history(user_id="anonymous", question="q", answer="a")
                insert_evidence_rows([{"user_id": "anonymous", "node_id": "book:n", "outcome": "assisted"}])
                count = migrate_user_id("anonymous", "registered")
                self.assertEqual(count, 1)
                self.assertEqual(len(get_chat_history("registered")), 1)
                self.assertEqual(len(list_evidence_for_user("registered")), 1)

    def test_migrate_api_derives_both_users_from_tokens(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                save_chat_history(user_id="anonymous", question="q", answer="a")
                insert_evidence_rows([{"user_id": "anonymous", "node_id": "book:n", "outcome": "assisted"}])
                old_token = create_access_token({"user_id": "anonymous"})
                new_token = create_access_token({"user_id": "registered"})
                response = TestClient(app).post(
                    "/api/chat/migrate",
                    json={"old_token": old_token},
                    headers={"Authorization": f"Bearer {new_token}"},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(list_evidence_for_user("registered")), 1)

    def test_migrate_deduplicates_client_turn_without_silent_drop(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                insert_evidence_rows([
                    {
                        "id": "target-e",
                        "user_id": "registered",
                        "node_id": "book:n",
                        "textbook_id": "book",
                        "client_turn_id": "same-turn",
                        "outcome": "assisted",
                    },
                    {
                        "id": "source-conflict",
                        "user_id": "anonymous",
                        "node_id": "book:n",
                        "textbook_id": "book",
                        "client_turn_id": "same-turn",
                        "outcome": "independent",
                    },
                    {
                        "id": "source-new",
                        "user_id": "anonymous",
                        "node_id": "book:m",
                        "textbook_id": "book",
                        "client_turn_id": "new-turn",
                        "outcome": "independent",
                    },
                ])
                migrate_user_id("anonymous", "registered")
                target = list_evidence_for_user("registered")
                source = list_evidence_for_user("anonymous")
                self.assertEqual({row["id"] for row in target}, {"target-e", "source-new"})
                self.assertEqual([row["id"] for row in source], ["source-conflict"])
                conn = get_conn()
                try:
                    skipped = conn.execute(
                        "SELECT evidence_id, reason FROM evidence_migration_skips"
                    ).fetchall()
                    self.assertEqual(len(skipped), 1)
                    self.assertEqual(skipped[0][0], "source-conflict")
                finally:
                    conn.close()

    def test_migration_revision_increments_only_target_for_new_evidence_and_keeps_runs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                insert_evidence_rows([{
                    "id": "source-e",
                    "user_id": "anonymous",
                    "node_id": "book:n",
                    "textbook_id": "book",
                    "outcome": "independent",
                }])
                conn = get_conn()
                try:
                    conn.execute(
                        "UPDATE learning_progress_revisions SET revision=9 WHERE user_id='anonymous' AND textbook_id='book'"
                    )
                    conn.execute(
                        "INSERT INTO learner_model_runs(id,user_id,textbook_id,catalog_version,adapter_version,model_version,input_revision,status,started_at) "
                        "VALUES ('run-source','anonymous','book','v','a','m',9,'succeeded','now')"
                    )
                    conn.commit()
                finally:
                    conn.close()
                migrate_user_id("anonymous", "registered")
                conn = get_conn()
                try:
                    revision = conn.execute(
                        "SELECT revision FROM learning_progress_revisions WHERE user_id='registered' AND textbook_id='book'"
                    ).fetchone()[0]
                    run_user = conn.execute(
                        "SELECT user_id FROM learner_model_runs WHERE id='run-source'"
                    ).fetchone()[0]
                finally:
                    conn.close()
        self.assertEqual(revision, 1)
        self.assertEqual(run_user, "anonymous")

    def test_read_time_model_sees_formal_user_after_evidence_migration(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                insert_evidence_rows([{
                    "id": "source-e",
                    "user_id": "anonymous",
                    "node_id": "gaodai_shang:n",
                    "textbook_id": "gaodai_shang",
                    "outcome": "independent",
                }])
                migrate_user_id("anonymous", "registered")
                estimate = compute_node_estimate(
                    "registered", "gaodai_shang", "gaodai_shang:n",
                )
        self.assertEqual(estimate["evidence_count"], 1)

    def test_migration_marks_both_identity_snapshots_stale(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(config, "DB_PATH", str(Path(temp_dir) / "learning.db")):
                init_db()
                insert_evidence_rows([{
                    "id": "source-e", "user_id": "anonymous",
                    "node_id": "gaodai_shang:n", "textbook_id": "gaodai_shang",
                    "outcome": "independent",
                }])
                conn = get_conn()
                try:
                    conn.execute(
                        "INSERT INTO learner_node_estimates "
                        "(user_id,textbook_id,node_id,catalog_version,adapter_version,model_version,"
                        "input_revision,alpha,beta,raw_mean,variance,recency,estimate,uncertainty,"
                        "learner_state,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        ("anonymous", "gaodai_shang", "gaodai_shang:n", "v", "a", "m", 1,
                         1, 1, .5, 1/12, 0, .5, 1, "unknown", "now"),
                    )
                    conn.execute(
                        "INSERT INTO learner_node_estimates "
                        "(user_id,textbook_id,node_id,catalog_version,adapter_version,model_version,"
                        "input_revision,alpha,beta,raw_mean,variance,recency,estimate,uncertainty,"
                        "learner_state,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        ("registered", "gaodai_shang", "gaodai_shang:n", "v", "a", "m", 1,
                         1, 1, .5, 1/12, 0, .5, 1, "unknown", "now"),
                    )
                    conn.commit()
                finally:
                    conn.close()
                migrate_user_id("anonymous", "registered")
                conn = get_conn()
                try:
                    rows = conn.execute(
                        "SELECT user_id,stale FROM learner_node_estimates "
                        "WHERE user_id IN ('anonymous','registered') ORDER BY user_id"
                    ).fetchall()
                finally:
                    conn.close()
        self.assertEqual([(row[0], row[1]) for row in rows], [("anonymous", 1), ("registered", 1)])


if __name__ == "__main__":
    unittest.main()
