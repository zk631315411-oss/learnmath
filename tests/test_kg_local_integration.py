import os
import unittest

from app.db.kg_v44 import retrieve_kg_context


@unittest.skipUnless(
    os.getenv("RUN_LOCAL_NEO4J_TESTS") == "1",
    "set RUN_LOCAL_NEO4J_TESTS=1 with a local read-only Neo4j configuration",
)
class LocalNeo4jRegressionTests(unittest.TestCase):
    CASES = [
        ("为什么线性无关要求所有系数为0", "gaodai_shang", "线性无关"),
        ("线性无关性", "gaodai_shang", "线性无关"),
        ("导数的几何意义", "gaoshu_shang", "导数的几何意义"),
        ("矩阵的秩", "gaodai_shang", "矩阵的秩"),
    ]

    def test_real_queries_resolve_expected_nodes(self):
        for query, textbook_id, expected_name in self.CASES:
            with self.subTest(query=query):
                result = retrieve_kg_context(query, textbook_id=textbook_id, focus=["overview"])
                self.assertEqual(result["status"], "resolved")
                self.assertEqual(result["selected_node"]["name"], expected_name)

    def test_linear_independence_expands_property_rule_cases(self):
        result = retrieve_kg_context(
            "为什么线性无关要求所有系数为0",
            textbook_id="gaodai_shang",
            focus=["rules"],
        )
        self.assertTrue(any(
            item["owner"]["path"] == "via_has_property"
            for item in result["rule_cases"]
        ))
        self.assertGreaterEqual(len(result["rule_cases"]), 1)

    def test_linear_independence_directional_contract(self):
        for focus in ("rules", "applications", "prerequisites", "overview"):
            with self.subTest(focus=focus):
                result = retrieve_kg_context(
                    "线性无关",
                    textbook_id="gaodai_shang",
                    focus=[focus],
                )
                self.assertEqual(result["status"], "resolved")
                self.assertEqual(result["requested_focus"], [focus])

        prerequisites = retrieve_kg_context(
            "线性无关",
            textbook_id="gaodai_shang",
            focus=["prerequisites"],
        )
        self.assertIn("prerequisites", prerequisites["empty_focus"])
        self.assertNotIn("supporting_knowledge", prerequisites.get("relationships", {}))


if __name__ == "__main__":
    unittest.main()
