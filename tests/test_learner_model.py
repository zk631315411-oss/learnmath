import unittest
from datetime import datetime, timezone

from app.services.learning.learner_model_types import DEFAULT_PARAMETERS
from app.services.learning.model_adapter import adapt_evidence
from app.services.learning.student_model import derive_state, project_snapshot_at, replay_node_evidence


UTC = timezone.utc


def row(
    evidence_id: str,
    outcome: str,
    *,
    created_at: str = "2026-01-01T00:00:00+00:00",
    scaffolding_level: int = 0,
    client_turn_id: str | None = None,
) -> dict:
    return {
        "id": evidence_id,
        "user_id": "u1",
        "node_id": "book:node",
        "textbook_id": "book",
        "outcome": outcome,
        "scaffolding_level": scaffolding_level,
        "created_at": created_at,
        "client_turn_id": client_turn_id,
    }


class LearnerModelReplayTests(unittest.TestCase):
    def test_empty_evidence_is_unknown_with_prior_uncertainty(self):
        estimate = replay_node_evidence([], as_of="2026-01-01T00:00:00+00:00")
        self.assertEqual(estimate.state, "unknown")
        self.assertEqual(estimate.estimate, 0.5)
        self.assertEqual(estimate.uncertainty, 1.0)
        self.assertEqual(estimate.decay_risk, 1.0)
        self.assertAlmostEqual(estimate.raw_mean, 0.5)
        self.assertAlmostEqual(estimate.variance, 1 / 12)
        self.assertEqual(estimate.recency, 0.0)

    def test_formula_contract_and_future_timestamp(self):
        estimate = replay_node_evidence(
            [row("a", "independent", created_at="2026-01-10T00:00:00+00:00")],
            as_of="2026-01-01T00:00:00+00:00",
        )
        self.assertEqual(estimate.recency, 1.0)
        self.assertAlmostEqual(estimate.raw_mean, 2 / 3)
        self.assertAlmostEqual(estimate.variance, 1 / 18)
        self.assertAlmostEqual(estimate.estimate, 2 / 3)
        self.assertGreaterEqual(estimate.uncertainty, 0.0)
        self.assertLessEqual(estimate.uncertainty, 1.0)

    def test_two_independent_do_not_reach_likely_ready(self):
        estimate = replay_node_evidence(
            [row("a", "independent"), row("b", "independent", created_at="2026-01-02T00:00:00+00:00")],
            as_of="2026-01-02T00:00:00+00:00",
        )
        self.assertAlmostEqual(estimate.raw_mean, 0.75)
        self.assertEqual(estimate.independent_count, 2)
        self.assertEqual(estimate.state, "emerging")
        self.assertGreater(estimate.uncertainty, 0.35)

    def test_prerequisite_is_not_part_of_node_replay(self):
        target = replay_node_evidence(
            [row("a", "independent"), row("b", "independent", created_at="2026-01-02T00:00:00+00:00")],
            as_of="2026-01-02T00:00:00+00:00",
        )
        self.assertAlmostEqual(target.estimate, 0.75)
        self.assertEqual(target.state, "emerging")

    def test_independent_with_scaffolding_is_assisted(self):
        adapted = adapt_evidence(row("a", "independent", scaffolding_level=1))
        self.assertEqual(adapted.effective_outcome, "assisted")
        self.assertFalse(adapted.effective_independent)
        self.assertTrue(adapted.effective_assisted)
        estimate = replay_node_evidence(
            [row("a", "independent", scaffolding_level=1)],
            as_of="2026-01-01T00:00:00+00:00",
        )
        self.assertEqual(estimate.independent_count, 0)
        self.assertEqual(estimate.assisted_count, 1)
        self.assertAlmostEqual(estimate.alpha, 1.5)
        self.assertAlmostEqual(estimate.beta, 1.25)
        self.assertNotEqual(estimate.state, "likely_ready")

    def test_seven_independent_decay_and_direct_or_unresolved_guard(self):
        rows = [
            row(str(index), "independent", created_at=f"2026-01-{index:02d}T00:00:00+00:00")
            for index in range(1, 8)
        ]
        current = replay_node_evidence(rows, as_of="2026-01-07T00:00:00+00:00")
        self.assertEqual(current.state, "likely_ready")
        self.assertGreaterEqual(current.independent_count, 7)

        decayed = replay_node_evidence(rows, as_of="2026-01-21T00:00:00+00:00")
        self.assertAlmostEqual(decayed.recency, 0.5, places=6)
        self.assertAlmostEqual(decayed.estimate, 0.6944444444, places=6)
        self.assertGreater(decayed.uncertainty, current.uncertainty)
        self.assertEqual(decayed.state, "emerging")

        taught = replay_node_evidence(
            rows + [row("t", "direct_taught", created_at="2026-01-22T00:00:00+00:00")],
            as_of="2026-01-22T00:00:00+00:00",
        )
        self.assertEqual(taught.state, "model_needs_review")
        self.assertAlmostEqual(taught.alpha, current.alpha)
        unresolved = replay_node_evidence(
            rows + [row("u", "unresolved", created_at="2026-01-22T00:00:00+00:00")],
            as_of="2026-01-22T00:00:00+00:00",
        )
        self.assertNotEqual(unresolved.state, "likely_ready")

    def test_replay_is_deterministic_and_client_retry_fixture_is_single_row(self):
        values = [row("a", "independent", client_turn_id="ct-1")]
        first = replay_node_evidence(values + values, as_of="2026-01-01T00:00:00+00:00")
        deduped = replay_node_evidence(values, as_of="2026-01-01T00:00:00+00:00")
        self.assertEqual(first.as_dict(), replay_node_evidence(values + values, as_of="2026-01-01T00:00:00+00:00").as_dict())
        self.assertEqual(first.as_dict(), deduped.as_dict())

    def test_rows_without_ids_remain_distinct_observations(self):
        estimate = replay_node_evidence([
            row("", "independent"),
            {**row("", "independent"), "created_at": "2026-01-02T00:00:00+00:00"},
        ], as_of="2026-01-02T00:00:00+00:00")
        self.assertEqual(estimate.evidence_count, 2)
        self.assertEqual(estimate.independent_count, 2)

    def test_low_estimate_review_threshold_precedes_unresolved_guard(self):
        self.assertEqual(
            derive_state(
                estimate=0.35,
                uncertainty=0.9,
                effective_independent_count=2,
                effective_assisted_count=0,
                last_outcome="unresolved",
            ),
            "model_needs_review",
        )

    def test_duplicate_identity_chooses_deterministic_earliest_row(self):
        earlier = row("a", "independent", client_turn_id="ct-1", created_at="2026-01-01T00:00:00+00:00")
        later = row("b", "direct_taught", client_turn_id="ct-1", created_at="2026-01-02T00:00:00+00:00")
        first = replay_node_evidence([later, earlier], as_of="2026-01-02T00:00:00+00:00")
        second = replay_node_evidence([earlier, later], as_of="2026-01-02T00:00:00+00:00")
        self.assertEqual(first.as_dict(), second.as_dict())
        self.assertEqual(first.last_outcome, "independent")

    def test_parameter_invariant_rejects_subunit_prior(self):
        from dataclasses import replace

        with self.assertRaises(ValueError):
            replay_node_evidence(
                [],
                as_of=datetime.now(UTC),
                parameters=replace(DEFAULT_PARAMETERS, prior_alpha=0.5),
            )

    def test_version_pair_and_parameter_changes_require_bump(self):
        from dataclasses import replace

        with self.assertRaises(ValueError):
            replay_node_evidence(
                [],
                parameters=replace(DEFAULT_PARAMETERS, half_life_days=7),
            )
        with self.assertRaises(ValueError):
            replay_node_evidence(
                [],
                parameters=replace(DEFAULT_PARAMETERS, model_version="learner-beta-v3"),
            )

    def test_read_projection_decays_without_mutating_beta_or_latest_guard(self):
        estimate = replay_node_evidence(
            [row("a", "independent", created_at="2026-01-01T00:00:00+00:00")],
            as_of="2026-01-01T00:00:00+00:00",
        )
        projected = project_snapshot_at(
            estimate.as_dict(), as_of="2026-01-15T00:00:00+00:00",
        )
        self.assertEqual(projected["alpha"], estimate.alpha)
        self.assertGreater(projected["uncertainty"], estimate.uncertainty)
        self.assertLess(projected["estimate"], estimate.estimate)


if __name__ == "__main__":
    unittest.main()
