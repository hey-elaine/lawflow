"""Coverage for AI chapter proposal parsing, overlap resolution and plan fallback."""
import json
import unittest
from unittest.mock import patch

from app import main as app_main


def make_blocks():
    long_a = "人工智能治理背景。" * 20
    long_b = "数据出境合规要求。" * 20
    long_c = "总体影响与趋势。" * 20
    return [
        {"id": "h1", "kind": "heading", "sequence_no": 1, "heading_level": 1, "text": "一、背景"},
        {"id": "p1", "kind": "paragraph", "sequence_no": 2, "text": long_a},
        {"id": "h2", "kind": "heading", "sequence_no": 3, "heading_level": 2, "text": "（一）治理范围"},
        {"id": "p2", "kind": "paragraph", "sequence_no": 4, "text": long_a},
        {"id": "h3", "kind": "heading", "sequence_no": 5, "heading_level": 1, "text": "二、数据出境"},
        {"id": "p3", "kind": "paragraph", "sequence_no": 6, "text": long_b},
        {"id": "h4", "kind": "heading", "sequence_no": 7, "heading_level": 1, "text": "三、总体影响"},
        {"id": "p4", "kind": "paragraph", "sequence_no": 8, "text": long_c},
    ]


class AiChapterProposalTest(unittest.TestCase):
    def test_accepts_model_output_and_designs_questions(self):
        proposal = app_main.ai_chapter_proposal.__wrapped__ if hasattr(app_main.ai_chapter_proposal, "__wrapped__") else None
        model_output = json.dumps({"chapters": [
            {"heading_id": "h1", "question": "人工智能治理的背景是什么？"},
            {"heading_id": "h3", "question": "数据出境有哪些触发条件？"},
            {"heading_id": "h4", "question": "总体影响如何评估？"},
        ]}, ensure_ascii=False)
        with patch.object(app_main, "model_chat", return_value=model_output):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertEqual([hid for hid, _ in picked], ["h1", "h3", "h4"])
        self.assertEqual(picked[0][1], "人工智能治理的背景是什么？")

    def test_strips_code_fences_from_model_output(self):
        model_output = "```json\n" + json.dumps({"chapters": [
            {"heading_id": "h1", "question": "q1"},
            {"heading_id": "h4", "question": "q2"},
        ]}, ensure_ascii=False) + "\n```"
        with patch.object(app_main, "model_chat", return_value=model_output):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertEqual(len(picked), 2)

    def test_truncated_output_rescues_complete_chapters(self):
        full = json.dumps({"chapters": [
            {"heading_id": "h1", "question": "人工智能治理的背景是什么？"},
            {"heading_id": "h3", "question": "数据出境有哪些触发条件？"},
            {"heading_id": "h4", "question": "总体影响如何评估？"},
        ]}, ensure_ascii=False)
        # 模拟 max_tokens 截断：最后一个章节对象被切在半截
        truncated = full[: full.rfind("}") - 40]
        with patch.object(app_main, "model_chat", return_value=truncated):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertEqual([hid for hid, _ in picked], ["h1", "h3"])
        self.assertEqual(picked[1][1], "数据出境有哪些触发条件？")

    def test_overlapping_parent_and_child_keeps_outer(self):
        model_output = json.dumps({"chapters": [
            {"heading_id": "h1", "question": "外层主题"},
            {"heading_id": "h2", "question": "内层主题"},
            {"heading_id": "h4", "question": "另一章"},
        ]}, ensure_ascii=False)
        with patch.object(app_main, "model_chat", return_value=model_output):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertEqual([hid for hid, _ in picked], ["h1", "h4"])

    def test_unknown_ids_and_out_of_order_are_normalized(self):
        model_output = json.dumps({"chapters": [
            {"heading_id": "h4", "question": "q"},
            {"heading_id": "ghost", "question": "无效"},
            {"heading_id": "h1", "question": "q"},
        ]}, ensure_ascii=False)
        with patch.object(app_main, "model_chat", return_value=model_output):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertEqual([hid for hid, _ in picked], ["h1", "h4"])

    def test_invalid_payload_raises_value_error(self):
        with patch.object(app_main, "model_chat", return_value="不是 JSON"):
            with self.assertRaises(ValueError):
                app_main.ai_chapter_proposal(make_blocks())

    def test_single_chapter_output_raises_value_error(self):
        model_output = json.dumps({"chapters": [{"heading_id": "h1", "question": "q"}]}, ensure_ascii=False)
        with patch.object(app_main, "model_chat", return_value=model_output):
            with self.assertRaises(ValueError):
                app_main.ai_chapter_proposal(make_blocks())

    def test_missing_question_falls_back_to_template(self):
        model_output = json.dumps({"chapters": [
            {"heading_id": "h1", "question": ""},
            {"heading_id": "h3", "question": None},
        ]}, ensure_ascii=False)
        with patch.object(app_main, "model_chat", return_value=model_output):
            picked = app_main.ai_chapter_proposal(make_blocks())
        self.assertTrue(all(question.strip() for _, question in picked))


class PlanTitleCleanupTest(unittest.TestCase):
    def test_auto_split_titles_have_no_output_prefix(self):
        chapters = app_main.create_plan_chapters(make_blocks(), "lexcast", None)
        self.assertTrue(chapters)
        for chapter in chapters:
            self.assertTrue(chapter["title"].startswith("第"))
            self.assertFalse(chapter["title"].startswith("法声解读"))
            self.assertIn("source_heading_id", chapter)

    def test_manual_selection_titles_have_no_output_prefix(self):
        chapters = app_main.create_plan_chapters(make_blocks(), "lexcast", ["h1", "h3"])
        self.assertEqual([chapter["title"] for chapter in chapters], ["第01章 · 背景", "第02章 · 数据出境"])
        self.assertEqual([chapter["source_heading_id"] for chapter in chapters], ["h1", "h3"])


if __name__ == "__main__":
    unittest.main()
