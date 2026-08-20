import itertools
import unittest

from app.services.learning.projection import is_blocked, project_status


def rows(*outcomes):
    return [{"outcome": value} for value in outcomes]


class LearningProjectionTests(unittest.TestCase):
    def test_named_sequences(self):
        cases = {
            ("independent", "independent"): "mastered",
            ("assisted", "assisted"): "needs_review",
            ("direct_taught", "independent"): "basically_mastered",
            ("assisted", "assisted", "assisted", "independent", "independent"): "mastered",
            ("unresolved",): "learning",
        }
        for sequence, expected in cases.items():
            with self.subTest(sequence=sequence):
                self.assertEqual(project_status(rows(*sequence)), expected)

    def test_recent_five_window(self):
        self.assertEqual(project_status(rows("assisted", "assisted", "assisted", "independent", "assisted", "independent")), "needs_review")
        self.assertEqual(project_status(rows("assisted", "assisted", "independent", "independent", "independent", "assisted")), "basically_mastered")

    def test_empty_and_unclosed(self):
        self.assertEqual(project_status([]), "unexplored")
        self.assertEqual(project_status(rows("unresolved", "independent")), "learning")

    def test_blocked_derivation(self):
        self.assertTrue(is_blocked(["needs_review", "needs_review"]))
        self.assertFalse(is_blocked([]))
        self.assertFalse(is_blocked(["needs_review", "mastered"]))

    def test_all_short_sequences_map_to_one_known_state(self):
        states = {"unexplored", "learning", "basically_mastered", "mastered", "needs_review"}
        outcomes = ["independent", "assisted", "direct_taught", "unresolved"]
        for length in range(6):
            for sequence in itertools.product(outcomes, repeat=length):
                self.assertIn(project_status(rows(*sequence)), states)


if __name__ == "__main__":
    unittest.main()
