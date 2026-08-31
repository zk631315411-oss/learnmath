import unittest

from app.services.qa.source_citations import (
    citation_codes,
    collect_kg_sources,
    finalize_sources,
    readable_snippet,
)


def _payload():
    return {
        "status": "resolved",
        "kg_basis_available": True,
        "scope": {"textbook_id": "gaodai_shang"},
        "selected_node": {
            "node_id": "n-selected",
            "name": "两行互换行列式反号",
            "chapter": "第2章 行列式",
            "section": "2.3 行列式的性质",
            "source_code": "gaodai_shang:C02:S03:U01:L1430-L1623",
            "evidence_span": "性质4 两行互换，行列式反号。",
        },
        "relationships": {
            "explicit_prerequisites": [{
                "node": {
                    "node_id": "n-prerequisite",
                    "name": "逆序数",
                    "chapter": "第2章 行列式",
                    "section": "2.1 n 元排列",
                    "source_code": "gaodai_shang:C02:S01:U01:L986-L1059",
                },
                "evidence_span": "我们先定义排列的逆序数。",
            }],
        },
    }


class SourceCitationTests(unittest.TestCase):
    def test_collects_private_selected_and_relationship_sources(self):
        sources, selected = collect_kg_sources(_payload())
        self.assertEqual(selected, "gaodai_shang:C02:S03:U01:L1430-L1623")
        self.assertEqual([source["node_id"] for source in sources], ["n-selected", "n-prerequisite"])
        self.assertEqual(sources[0]["textbook_name"], "高等代数上册")
        self.assertIn("性质4", sources[0]["snippet"])

    def test_invalid_markers_are_rejected_and_selected_node_is_fallback(self):
        candidates, selected = collect_kg_sources(_payload())
        answer = (
            "先回忆逆序数 [[cite:gaodai_shang:C02:S01:U01:L986-L1059]]。"
            "伪造项 [[cite:invented:C99]]。"
        )
        sources = finalize_sources(answer, candidates, [selected or ""])
        self.assertEqual(
            [source["source_code"] for source in sources],
            [
                "gaodai_shang:C02:S01:U01:L986-L1059",
                "gaodai_shang:C02:S03:U01:L1430-L1623",
            ],
        )

    def test_deduplicates_and_caps_sources(self):
        base = collect_kg_sources(_payload())[0][0]
        candidates = [{**base, "source_code": f"book:{index}"} for index in range(8)]
        answer = " ".join(f"[[cite:book:{index}]]" for index in range(8))
        sources = finalize_sources(answer, [candidates[0], *candidates, candidates[0]], [])
        self.assertEqual([source["source_code"] for source in sources], [f"book:{i}" for i in range(5)])

    def test_no_resolved_kg_means_no_sources(self):
        self.assertEqual(collect_kg_sources({"status": "not_found"}), ([], None))
        incomplete = _payload()
        incomplete["selected_node"].pop("evidence_span")
        incomplete["relationships"] = {}
        self.assertEqual(collect_kg_sources(incomplete), ([], None))

    def test_snippet_uses_first_paragraph_and_does_not_leave_open_math(self):
        self.assertEqual(readable_snippet("第一段。\n\n第二段。"), "第一段。")
        value = "完整句。" + ("甲" * 790) + "$x+y"
        snippet = readable_snippet(value)
        self.assertLessEqual(len(snippet), 150)
        self.assertEqual(snippet.count("$") % 2, 0)

    def test_citation_parser_preserves_first_appearance_order(self):
        self.assertEqual(citation_codes("[[cite:a:1]] [[cite:b:2]] [[cite:a:1]]"), ["a:1", "b:2"])


if __name__ == "__main__":
    unittest.main()
