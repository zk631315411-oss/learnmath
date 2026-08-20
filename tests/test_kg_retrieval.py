import unittest
from unittest.mock import patch

from app.db import kg_v44
from app.services.agents.tools.retrieve_kg_context import (
    _present_retrieve_result,
    build_retrieve_kg_context_tool,
)
from app.services.agents.tool_def import ToolArgumentError


def candidate(node_id: str, name: str, match_type: str) -> dict:
    return {"node_id": node_id, "name": name, "type": "Concept", "match_type": match_type}


class KGRetrievalTests(unittest.TestCase):
    def test_chapter_lists_use_natural_numeric_order(self):
        rows = [
            {"chapter": "第10章 具有度量的线性空间", "node_count": 1, "node_ids": ["n10"]},
            {"chapter": "7. 多项式环", "node_count": 1, "node_ids": ["n7"]},
            {"chapter": "附录A", "node_count": 1, "node_ids": ["na"]},
            {"chapter": "绪论", "node_count": 1, "node_ids": ["intro"]},
            {"chapter": "第 11 章 线性变换", "node_count": 1, "node_ids": ["n11"]},
            {"chapter": "第9章 线性映射", "node_count": 1, "node_ids": ["n9"]},
        ]
        expected = ["绪论", "7. 多项式环", "第9章 线性映射", "第10章 具有度量的线性空间", "第 11 章 线性变换", "附录A"]

        with patch.object(kg_v44, "_run", return_value=rows):
            chapters = kg_v44.list_kg_chapters("gaodai_xia")
            chapter_nodes = kg_v44.list_kg_chapter_nodes("gaodai_xia")

        self.assertEqual([item["chapter"] for item in chapters], expected)
        self.assertEqual([item["chapter"] for item in chapter_nodes], expected)
        self.assertEqual(chapter_nodes[3]["node_ids"], ["n10"])

    def test_query_runner_rejects_write_cypher_before_opening_a_session(self):
        with patch.object(kg_v44, "_session") as session:
            with self.assertRaisesRegex(ValueError, "read-only"):
                kg_v44._run("MATCH (n) SET n.changed = true RETURN n")
        session.assert_not_called()

    def test_unique_exact_candidate_wins_over_broader_candidates(self):
        candidates = [
            candidate("exact", "矩阵的秩", "exact_name"),
            candidate("broad", "矩阵", "name_in_query"),
        ]
        node = {"node_id": "exact", "name": "矩阵的秩", "type": "Concept"}
        with (
            patch.object(kg_v44, "search_kg_candidates", return_value=candidates),
            patch.object(kg_v44, "get_kg_node", return_value=node),
            patch.object(kg_v44, "get_kg_relationships", return_value=({}, {})),
            patch.object(kg_v44, "get_kg_rule_cases", return_value=[]),
        ):
            result = kg_v44.retrieve_kg_context("矩阵的秩", textbook_id="gaodai_shang")

        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["selected_node"]["node_id"], "exact")
        self.assertEqual(result["selected_node"]["match_type"], "exact_name")

    def test_true_multiple_candidates_are_ambiguous_without_scores(self):
        candidates = [
            candidate("a", "导数", "name_in_query"),
            candidate("b", "方向导数", "query_in_name_or_alias"),
        ]
        with patch.object(kg_v44, "search_kg_candidates", return_value=candidates):
            result = kg_v44.retrieve_kg_context(
                "导数问题", textbook_id="gaoshu_shang", focus=["rules"]
            )

        self.assertEqual(result["status"], "ambiguous")
        self.assertEqual(result["requested_focus"], ["rules"])
        self.assertEqual(result["retrieved_focus"], [])
        self.assertNotIn("score", str(result))

    def test_node_id_resolves_an_ambiguous_followup(self):
        node = {"node_id": "b", "name": "方向导数", "type": "Concept"}
        with (
            patch.object(kg_v44, "get_kg_node", return_value=node),
            patch.object(kg_v44, "get_kg_relationships", return_value=({}, {})),
            patch.object(kg_v44, "get_kg_rule_cases", return_value=[]),
        ):
            result = kg_v44.retrieve_kg_context(
                "导数问题", node_id="b", textbook_id="gaoshu_shang", focus=["rules"]
            )

        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["selected_node"]["match_type"], "selected_node_id")
        self.assertEqual(result["requested_focus"], ["rules"])
        self.assertEqual(result["retrieved_focus"], ["rules"])

    def test_relationships_are_grouped_by_type_and_direction(self):
        rows = [
            {"focus_key": "prerequisites", "item": {"node_id": "p", "name": "前置", "type": "Concept", "relationship_type": "PREREQUISITE_OF", "direction": "incoming"}},
            {"focus_key": "successors", "item": {"node_id": "s", "name": "后置", "type": "Concept", "relationship_type": "PREREQUISITE_OF", "direction": "outgoing"}},
            {"focus_key": "supporting", "item": {"node_id": "u", "name": "使用", "type": "Concept", "relationship_type": "USES", "direction": "outgoing"}},
            {"focus_key": "applications", "item": {"node_id": "a", "name": "应用", "type": "Concept", "relationship_type": "USES", "direction": "incoming"}},
            {"focus_key": "structure", "item": {"node_id": "e", "name": "并列", "type": "Concept", "relationship_type": "EQUATIVE", "direction": "outgoing"}},
        ]
        with patch.object(kg_v44, "_run", return_value=rows):
            groups, stats = kg_v44.get_kg_relationships(
                "selected",
                focus=["prerequisites", "successors", "supporting", "applications", "structure"],
            )

        self.assertEqual(groups["explicit_prerequisites"][0]["node"]["name"], "前置")
        self.assertEqual(groups["explicit_successors"][0]["node"]["name"], "后置")
        self.assertEqual(groups["supporting_knowledge"][0]["node"]["name"], "使用")
        self.assertEqual(groups["applications_and_extensions"][0]["node"]["name"], "应用")
        self.assertIn("不表示数学等价", groups["structural_context"][0]["meaning"])
        self.assertEqual(stats["successors"]["returned_count"], 1)

    def test_relationship_query_uses_requested_types_and_limit_plus_one(self):
        rows = [{
            "focus_key": "applications",
            "item": {
                "node_id": f"node-{index}", "name": f"应用{index:02d}",
                "type": "Concept", "relationship_type": "USES", "direction": "incoming",
            },
        } for index in range(16)]
        with patch.object(kg_v44, "_run", return_value=rows) as run:
            groups, stats = kg_v44.get_kg_relationships(
                "selected", focus=["applications"], limit_per_group=15
            )

        self.assertEqual(len(groups["applications_and_extensions"]), 15)
        self.assertEqual(stats["applications"], {"returned_count": 15, "truncated": True})
        self.assertEqual(run.call_args.kwargs["fetch_limit"], 16)
        self.assertEqual(
            set(run.call_args.kwargs["relation_types"]),
            {"USES", "DERIVES", "GETS", "HAS_PROPERTY"},
        )
        self.assertEqual(run.call_args.kwargs["focus_keys"], ["applications"])

    def test_prerequisites_query_does_not_fetch_other_relation_types(self):
        with patch.object(kg_v44, "_run", return_value=[]) as run:
            groups, stats = kg_v44.get_kg_relationships(
                "selected", focus=["prerequisites"]
            )

        self.assertEqual(groups, {"explicit_prerequisites": []})
        self.assertEqual(stats["prerequisites"]["returned_count"], 0)
        self.assertEqual(run.call_args.kwargs["relation_types"], ["PREREQUISITE_OF"])

    def test_rule_cases_expand_condition_refs_only_inside_selected_rules(self):
        rule = {
            "rule_id": "rule-1", "name": "判定", "owner_node_id": "theorem-1",
            "owner_name": "判定定理", "owner_type": "Theorem", "owner_path": "via_has_property",
            "property_conditions": [], "property_outcomes": [],
        }
        condition = {
            "rule_id": "rule-1", "condition_id": "condition-1", "condition": "只有零解",
            "condition_relation": "HAS_CONDITION", "required_node_id": "concept-1",
            "required_name": "齐次线性方程组", "required_type": "Concept",
        }
        outcome = {
            "rule_id": "rule-1", "outcome_id": "outcome-1", "outcome": "线性无关",
            "outcome_relation": "HAS_OUTCOME",
        }
        with patch.object(kg_v44, "_run", side_effect=[[rule], [condition], [outcome]]) as run:
            result = kg_v44.get_kg_rule_cases("concept-0")

        self.assertEqual(result[0]["owner"]["path"], "via_has_property")
        self.assertEqual(result[0]["conditions"][0]["required_knowledge"][0]["name"], "齐次线性方程组")
        self.assertEqual(run.call_count, 3)
        self.assertIn("(condition)-[:REFERS_TO]->(required:KGNode)", run.call_args_list[1].args[0])
        self.assertNotIn("REFERS_TO", run.call_args_list[0].args[0])

    def test_focus_contract_defaults_and_rejects_invalid_combinations(self):
        self.assertEqual(kg_v44.normalize_focus(None), ["overview"])
        self.assertEqual(kg_v44.normalize_focus(["rules", "applications"]), ["rules", "applications"])
        for invalid in ([], ["rules", "rules"], ["overview", "rules"], ["rules", "structure", "applications"], ["unknown"]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                kg_v44.normalize_focus(invalid)

    def test_tool_schema_exposes_focus_and_forwards_validated_default(self):
        tool = build_retrieve_kg_context_tool(textbook_id="gaodai_shang", page_number=12)
        schema = tool.schema()
        self.assertEqual(tool.name, "retrieve_kg_context")
        self.assertEqual(set(schema["properties"]), {"query", "node_id", "focus"})
        self.assertEqual(schema["required"], ["query"])
        with patch("app.services.agents.tools.retrieve_kg_context.retrieve_kg_context", return_value={"status": "not_found"}) as retrieve:
            validated = tool.validate_arguments({"query": "未知概念"})
            tool.execute(**validated)
        retrieve.assert_called_once_with(
            "未知概念", node_id=None, focus=["overview"], textbook_id="gaodai_shang", page_number=12
        )
        for invalid_focus in (["rules", "rules"], ["overview", "rules"], ["rules", "structure", "applications"], ["unknown"]):
            with self.subTest(focus=invalid_focus), self.assertRaises(ToolArgumentError):
                tool.validate_arguments({"query": "线性无关", "focus": invalid_focus})

    def test_overview_caps_each_direction_at_five_and_queries_rules(self):
        node = {
            "node_id": "node-1", "name": "线性无关", "type": "Concept",
            "definition": "定义", "evidence_span": "教材证据",
        }

        def relationships(_node_id, *, focus, textbook_id, limit_per_group):
            self.assertEqual(limit_per_group, 5)
            self.assertEqual(
                focus,
                ["prerequisites", "successors", "supporting", "applications", "structure"],
            )
            return ({
                "explicit_prerequisites": [],
                "explicit_successors": [],
                "supporting_knowledge": [],
                "applications_and_extensions": [],
                "structural_context": [],
            }, {
                key: {"returned_count": 0, "truncated": False}
                for key in focus
            })

        rules = [{"rule_id": f"rule-{index}"} for index in range(6)]
        with (
            patch.object(kg_v44, "search_kg_candidates", return_value=[candidate("node-1", "线性无关", "exact_name")]),
            patch.object(kg_v44, "get_kg_node", return_value=node),
            patch.object(kg_v44, "get_kg_relationships", side_effect=relationships),
            patch.object(kg_v44, "get_kg_rule_cases", return_value=rules) as get_rules,
        ):
            result = kg_v44.retrieve_kg_context("线性无关", focus=["overview"])

        self.assertEqual(len(result["rule_cases"]), 5)
        self.assertEqual(result["focus_stats"]["rules"], {"returned_count": 5, "truncated": True})
        self.assertEqual(result["empty_focus"], ["prerequisites", "successors", "supporting", "applications", "structure"])
        self.assertEqual(get_rules.call_args.kwargs["limit"], 6)

    def test_unrequested_directions_are_absent_and_rules_are_not_queried(self):
        node = {"node_id": "node-1", "name": "线性无关", "type": "Concept"}
        with (
            patch.object(kg_v44, "get_kg_node", return_value=node),
            patch.object(
                kg_v44,
                "get_kg_relationships",
                return_value=(
                    {"explicit_prerequisites": []},
                    {"prerequisites": {"returned_count": 0, "truncated": False}},
                ),
            ),
            patch.object(kg_v44, "get_kg_rule_cases") as get_rules,
        ):
            result = kg_v44.retrieve_kg_context(
                "线性无关", node_id="node-1", focus=["prerequisites"]
            )

        self.assertEqual(result["empty_focus"], ["prerequisites"])
        self.assertEqual(set(result["relationships"]), {"explicit_prerequisites"})
        self.assertNotIn("rule_cases", result)
        get_rules.assert_not_called()

    def test_public_result_omits_large_model_only_evidence(self):
        public = _present_retrieve_result({
            "status": "resolved",
            "kg_basis_available": True,
            "selected_node": {
                "node_id": "node-1",
                "name": "线性无关",
                "type": "Concept",
                "source_code": "book:C03",
                "definition": "very large definition",
                "evidence_span": "very large evidence",
            },
            "relationships": {},
            "rule_cases": [{"rule_id": "rule-1"}],
        })

        self.assertEqual(public["status"], "resolved")
        self.assertEqual(public["rule_case_count"], 1)
        self.assertNotIn("definition", str(public))
        self.assertNotIn("evidence_span", str(public))


if __name__ == "__main__":
    unittest.main()
