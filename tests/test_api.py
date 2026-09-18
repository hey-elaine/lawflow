from __future__ import annotations

import io
import importlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient


class LawFlowApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app.main as main
        cls.main = importlib.reload(main)
        cls.temp_dir = Path(tempfile.mkdtemp(prefix="lawflow-test-"))
        cls.main.DATA_DIR = cls.temp_dir / "data"
        cls.main.PROJECTS_DIR = cls.main.DATA_DIR / "projects"
        cls.main.EXPORTS_DIR = cls.main.DATA_DIR / "exports"
        cls.main.DB_PATH = cls.main.DATA_DIR / "app.db"
        cls.main.DEFAULT_EXPORT_DIR = cls.temp_dir / "Desktop" / "ai_law"
        for directory in (cls.main.DATA_DIR, cls.main.PROJECTS_DIR, cls.main.EXPORTS_DIR, cls.main.DATA_DIR / "temp", cls.main.DATA_DIR / "logs"):
            directory.mkdir(parents=True, exist_ok=True)
        cls.main.init_db()
        cls.client = TestClient(cls.main.app)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    @staticmethod
    def make_docx() -> bytes:
        xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>一、数据跨境合规</w:t></w:r></w:p>
        <w:p><w:r><w:t>企业需要确认跨境传输的业务必要性，并完成个人信息保护影响评估。</w:t></w:r></w:p>
        <w:p><w:r><w:t>涉及个人信息时，应当核验数据接收方和传输路径。</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>二、后续建议</w:t></w:r></w:p>
        <w:p><w:r><w:t>建议建立责任人、时间点和材料依据明确的任务清单。</w:t></w:r></w:p>
        <w:sectPr/></w:body></w:document>"""
        content_types = """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"""
        relationships = """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""
        output = io.BytesIO()
        with ZipFile(output, "w", ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", content_types)
            archive.writestr("_rels/.rels", relationships)
            archive.writestr("word/document.xml", xml)
        return output.getvalue()

    def test_end_to_end_project_workflow(self):
        project = self.client.post("/api/projects", json={"name": "测试项目", "client_name": "测试客户", "scenario": "speaking_note", "transform_mode": "enrich", "verification_mode": "external_verify", "target_duration": 20, "audio_enabled": False})
        self.assertEqual(project.status_code, 201)
        project_id = project.json()["id"]

        upload = self.client.post(f"/api/projects/{project_id}/documents", files={"file": ("测试材料.docx", self.make_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        self.assertEqual(upload.status_code, 201)
        document_id = upload.json()["id"]
        self.assertGreater(upload.json()["block_count"], 3)

        plan = self.client.post(f"/api/projects/{project_id}/plans", json={"source_document_id": document_id, "audience": "企业法务", "output_type": "client_brief", "style_name": "专业、克制"})
        self.assertEqual(plan.status_code, 201)
        plan_data = plan.json()
        self.assertTrue(plan_data["chapters"])

        confirmed = self.client.put(f"/api/plans/{plan_data['id']}/confirm", json={"chapters": plan_data["chapters"]})
        self.assertEqual(confirmed.status_code, 200)
        self.assertTrue(confirmed.json()["tasks_generated"])
        self.assertGreater(len(self.client.get(f"/api/projects/{project_id}").json()["tasks"]), 0)
        chapter = plan_data["chapters"][0]

        content = self.client.post(f"/api/plans/{plan_data['id']}/contents", json={"chapter_id": chapter["id"], "title": chapter["title"], "source_block_ids": chapter["source_block_ids"], "audience": "企业法务", "output_type": "client_brief", "style_name": "专业、克制"})
        self.assertEqual(content.status_code, 201)
        self.assertGreater(len(content.json()["claims"]), 0)

        reviewed = self.client.put(f"/api/contents/{content.json()['id']}/review", json={"status": "confirmed", "note": "测试确认"})
        self.assertEqual(reviewed.status_code, 200)

        export_root = self.temp_dir / "custom-exports"
        export_settings = self.client.put("/api/settings/export", json={"output_directory": str(export_root)})
        self.assertEqual(export_settings.status_code, 200)
        self.assertEqual(export_settings.json()["output_directory"], str(export_root.resolve()))

        output = self.client.post(f"/api/projects/{project_id}/exports")
        self.assertEqual(output.status_code, 201)
        export_data = output.json()
        self.assertTrue(Path(export_data["output_dir"]).is_dir())
        self.assertTrue(Path(export_data["archive_path"]).is_file())
        self.assertTrue((Path(export_data["output_dir"]) / "待核验事项与项目任务.xlsx").is_file())

        deleted = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(f"/api/projects/{project_id}").status_code, 404)
        self.assertFalse((self.main.PROJECTS_DIR / project_id).exists())
        self.assertTrue(Path(export_data["output_dir"]).is_dir())

    def test_narrative_requires_configured_model_before_outline(self):
        project = self.client.post("/api/projects", json={"name": "长文生成测试", "scenario": "legal_podcast", "transform_mode": "enrich", "verification_mode": "external_verify", "target_duration": 20, "audio_enabled": True}).json()
        project_id = project["id"]
        upload = self.client.post(f"/api/projects/{project_id}/documents", files={"file": ("测试材料.docx", self.make_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        document_id = upload.json()["id"]
        document = self.client.get(f"/api/documents/{document_id}").json()
        block_ids = [block["id"] for block in document["blocks"] if block["kind"] == "paragraph"]
        response = self.client.post(f"/api/projects/{project_id}/narrative-outlines", json={
            "document_id": document_id,
            "title": "数据跨境合规解读",
            "source_block_ids": block_ids,
            "audience": "企业法务",
            "style_profile": "law_podcast_v4",
            "target_length": "short",
        })
        self.assertEqual(response.status_code, 409)
        self.assertIn("核验与来源", response.json()["detail"])

    def test_daily_brief_skips_tasks_and_creates_audio_script(self):
        project = self.client.post("/api/projects", json={"name": "晨间速听", "scenario": "daily_brief", "transform_mode": "condense", "verification_mode": "source_only", "target_duration": 5, "audio_enabled": True}).json()
        project_id = project["id"]
        upload = self.client.post(f"/api/projects/{project_id}/documents", files={"file": ("news.txt", b"# Legal update\nThe regulator published a new rule. Businesses should review the effective date and implementation timeline.", "text/plain")})
        document_id = upload.json()["id"]
        document = self.client.get(f"/api/documents/{document_id}").json()
        source_ids = [block["id"] for block in document["blocks"] if block["kind"] == "paragraph"]
        plan = self.client.post(f"/api/projects/{project_id}/plans", json={"source_document_id": document_id, "audience": "个人学习", "output_type": "lexcast", "style_name": "简洁"}).json()
        confirmed = self.client.put(f"/api/plans/{plan['id']}/confirm", json={"chapters": plan["chapters"]})
        self.assertFalse(confirmed.json()["tasks_generated"])
        self.assertEqual(self.client.get(f"/api/projects/{project_id}").json()["tasks"], [])
        saved = self.client.post(f"/api/projects/{project_id}/skill-host-contents", json={"document_id": document_id, "title": "Morning legal brief", "markdown": "# Morning legal brief\n\nThe regulator published a new rule. Businesses should review the implementation timeline.", "source_block_ids": source_ids, "style_profile": "law_podcast_v4"})
        self.assertEqual(saved.status_code, 201)
        audio = self.client.post(f"/api/projects/{project_id}/audio-scripts", json={"narrative_content_id": saved.json()["id"]})
        self.assertEqual(audio.status_code, 201)
        self.assertIn("法律速听", audio.json()["script"])

    def test_narrative_outline_content_and_docx_export_with_mocked_model(self):
        project = self.client.post("/api/projects", json={"name": "知识转译测试"}).json()
        project_id = project["id"]
        upload = self.client.post(f"/api/projects/{project_id}/documents", files={"file": ("测试材料.docx", self.make_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        document_id = upload.json()["id"]
        document = self.client.get(f"/api/documents/{document_id}").json()
        block_ids = [block["id"] for block in document["blocks"] if block["kind"] == "paragraph"]

        original_model_chat = self.main.model_chat
        calls = []

        def fake_model_chat(messages, temperature=0.35, max_tokens=4096):
            calls.append(messages[-1]["content"])
            if len(calls) == 1:
                return """{
                  "title": "数据跨境合规的实务判断",
                  "opening_angle": "同一项跨境安排，往往同时牵动业务必要性与个人信息保护义务。",
                  "closing_angle": "企业需要把规则要求放回具体的数据链路与责任分工中核验。",
                  "sections": [
                    {"heading": "从业务安排识别问题", "purpose": "说明业务背景", "key_points": ["跨境传输必要性"], "source_block_ids": [""" + json.dumps(block_ids[0]) + """], "target_words": 300},
                    {"heading": "评估与留痕如何落地", "purpose": "说明合规动作", "key_points": ["影响评估"], "source_block_ids": [""" + json.dumps(block_ids[-1]) + """], "target_words": 300}
                  ]
                }"""
            return "本节围绕材料所述的数据处理安排展开。企业首先需要还原业务必要性，再将相应的评估和留痕要求纳入既有流程。"

        self.main.model_chat = fake_model_chat
        try:
            outline_response = self.client.post(f"/api/projects/{project_id}/narrative-outlines", json={
                "document_id": document_id,
                "title": "数据跨境合规的实务判断",
                "source_block_ids": block_ids,
                "audience": "企业法务",
                "style_profile": "law_podcast_v4",
                "target_length": "short",
            })
            self.assertEqual(outline_response.status_code, 201)
            outline = outline_response.json()
            self.assertEqual(len(outline["outline"]["sections"]), 2)

            confirmed = self.client.put(f"/api/narrative-outlines/{outline['id']}/confirm", json={"outline": outline["outline"]})
            self.assertEqual(confirmed.status_code, 200)
            content = self.client.post(f"/api/narrative-outlines/{outline['id']}/contents")
            self.assertEqual(content.status_code, 201)
            self.assertIn("从业务安排识别问题", content.json()["markdown"])

            exported = self.client.post(f"/api/narrative-contents/{content.json()['id']}/export")
            self.assertEqual(exported.status_code, 201)
            self.assertTrue(Path(exported.json()["markdown_path"]).is_file())
            self.assertTrue(Path(exported.json()["docx_path"]).is_file())
        finally:
            self.main.model_chat = original_model_chat

    def test_skill_host_model_can_read_context_and_write_back_content(self):
        project = self.client.post("/api/projects", json={"name": "Skill 宿主模型测试"}).json()
        project_id = project["id"]
        upload = self.client.post(f"/api/projects/{project_id}/documents", files={"file": ("测试材料.docx", self.make_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
        document_id = upload.json()["id"]
        context = self.client.get(f"/api/skill/projects/{project_id}/context", params={"document_id": document_id, "limit": 20})
        self.assertEqual(context.status_code, 200)
        self.assertTrue(context.json()["blocks"])
        source_ids = [block["id"] for block in context.json()["blocks"] if block["kind"] == "paragraph"]
        saved = self.client.post(f"/api/projects/{project_id}/skill-host-contents", json={
            "document_id": document_id,
            "title": "由宿主模型生成的解读",
            "markdown": "# 由宿主模型生成的解读\n\n## 背景\n\n基于已选材料形成的长文。",
            "source_block_ids": source_ids,
            "style_profile": "law_podcast_v4",
        })
        self.assertEqual(saved.status_code, 201)
        project_state = self.client.get(f"/api/projects/{project_id}").json()
        self.assertEqual(len(project_state["narrative_contents"]), 1)
        self.assertEqual(project_state["narrative_contents"][0]["model"]["mode"], "host_model")


if __name__ == "__main__":
    unittest.main()
