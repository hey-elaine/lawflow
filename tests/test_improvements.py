"""Regression coverage for profiles, source boundaries, audio and exports."""
import json
import subprocess
import unittest
from unittest.mock import patch
from pathlib import Path

from tests import test_api as fixtures


class ImprovementsTest(unittest.TestCase):
    setUpClass = classmethod(fixtures.LawFlowApiTest.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.LawFlowApiTest.tearDownClass.__func__)

    def make_content(self):
        project = self.client.post('/api/projects', json={'name': '回归', 'scenario': 'daily_brief', 'transform_mode': 'condense', 'verification_mode': 'source_only'}).json()
        source = self.client.post(f"/api/projects/{project['id']}/text-sources", json={'title': '素材', 'content': '这是原始材料，需要保留事实和限制条件。企业应当按照实际情况评估。'}).json()
        document = self.client.get(f"/api/documents/{source['id']}").json()
        ids = [b['id'] for b in document['blocks'] if b['kind'] == 'paragraph']
        content = self.client.post(f"/api/projects/{project['id']}/skill-host-contents", json={'document_id':source['id'], 'title':'测试讲稿', 'markdown':'# 讲稿\n\n这是**材料**正文。请参考[说明](https://example.com)。', 'source_block_ids':ids}).json()
        return project, source, ids, content

    def test_custom_profile_persistence_and_prompt(self):
        data = {'name':'自定义', 'description':'问答式', 'instruction':'先提出具体问题，再逐步解释，保持克制的表达。'}
        response = self.client.post('/api/narrative/profiles', json=data)
        self.assertEqual(response.status_code, 201)
        pid = response.json()['id']
        self.main.init_db()  # Existing-database migration must retain profiles.
        self.assertEqual(self.main.get_style_profiles()[pid]['instruction'], data['instruction'])
        self.assertEqual(self.client.put('/api/narrative/profiles/law_podcast_v4', json=data).status_code, 400)
        data['name'] = '修改名称'
        self.assertEqual(self.client.put('/api/narrative/profiles/' + pid, json=data).status_code, 200)
        request = self.main.NarrativeOutlineRequest(document_id='d', title='测试', source_block_ids=['b'], style_profile=pid, transform_mode='condense', target_duration=3)
        raw = {'sections':[{'heading':'问题', 'source_block_ids':['b']}], 'opening_angle':'先提出问题'}
        blocks = [{'id':'b', 'kind':'paragraph', 'text':'材料正文', 'source_locator':'段落 1'}]
        with patch.object(self.main, 'model_chat', return_value=json.dumps(raw)) as model:
            outline = self.main.create_narrative_outline(request, blocks)
            self.assertIn(data['instruction'], model.call_args.args[0][-1]['content'])
        self.assertEqual(len(outline['sections']), 1)
        self.assertLessEqual(outline['target_total_words'], 720)

    def test_profile_extraction_is_draft_and_validates_response(self):
        before = len(self.client.get('/api/narrative/profiles').json())
        draft = {'name':'叙事', 'description':'自然', 'instruction':'用具体问题切入，解释术语并用自然的承接句组织段落。'}
        with patch.object(self.main, 'model_chat', return_value=json.dumps(draft)):
            result = self.client.post('/api/narrative/profile-draft', json={'transcript':'播客素材。' * 40})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['status'], 'draft')
        self.assertEqual(len(self.client.get('/api/narrative/profiles').json()), before)
        with patch.object(self.main, 'model_chat', return_value='{"name":"empty"}'):
            result = self.client.post('/api/narrative/profile-draft', json={'transcript':'素材' * 60})
        self.assertEqual(result.status_code, 502)

    def test_transcription_requires_consent_and_configuration(self):
        with patch.object(self.main, 'get_internal_provider_settings', return_value={}):
            response = self.client.post('/api/narrative/transcribe', files={'file':('clip.mp3', b'audio', 'audio/mpeg')})
        self.assertEqual(response.status_code, 400)
        self.assertIn('允许', response.json()['detail'])
        config = {'allow_source_upload':True, 'asr_base_url':'https://asr.example/v1', 'asr_model':'asr', 'asr_api_key':'secret'}
        import httpx
        from unittest.mock import AsyncMock
        response = httpx.Response(200, json={'text':'转写结果'}, request=httpx.Request('POST', 'https://asr.example'))
        with patch.dict('os.environ', {}, clear=True), patch.object(self.main, 'get_internal_provider_settings', return_value=config), patch.object(httpx.AsyncClient, 'post', new=AsyncMock(return_value=response)):
            result = self.client.post('/api/narrative/transcribe', files={'file':('clip.mp3', b'audio', 'audio/mpeg')})
        self.assertEqual(result.json()['transcript'], '转写结果')

    def test_source_validation_and_budget_no_silent_truncation(self):
        self.assertEqual(self.main.read_blocks('missing', []), [])
        request = self.main.NarrativeOutlineRequest(document_id='d', title='测试', source_block_ids=['b'], transform_mode='condense')
        blocks = [{'id':'b', 'kind':'paragraph', 'text':'正文' * 100, 'source_locator':'1'}]
        with self.assertRaises(self.main.HTTPException):
            self.main.normalize_narrative_outline({'sections':[{'heading':'内容','source_block_ids':['invented']}]}, request, blocks)
        with self.assertRaises(self.main.HTTPException):
            self.main.source_dossier(blocks, max_total_chars=50)
        self.assertIn('正文' * 100, self.main.source_dossier(blocks, max_chars_per_block=10))

    def test_confirm_rejects_invalid_outline_and_writing_hints_not_published(self):
        project, source, ids, content = self.make_content()
        row = self.client.get('/api/projects/' + project['id']).json()['narrative_outlines'][0]
        invalid = {'sections':[{'heading':'不合法','source_block_ids':['foreign']}]}
        self.assertEqual(self.client.put('/api/narrative-outlines/' + row['id'] + '/confirm', json={'outline':invalid}).status_code, 400)
        outline = {'title':'标题', 'opening_angle':'请从问题切入', 'closing_angle':'请总结', 'sections':[{'id':'s1','heading':'正文','source_block_ids':ids,'target_words':300}]}
        with patch.object(self.main, 'model_chat', return_value='实际生成的正文。') as model:
            text, _, _ = self.main.generate_narrative_markdown(outline, self.main.read_blocks(source['id']), '读者', 'law_podcast_v4')
        self.assertNotIn('请从问题切入', text)
        self.assertIn('请从问题切入', model.call_args.args[0][-1]['content'])

    def test_audio_edit_preview_and_narrative_only_export(self):
        project, source, ids, content = self.make_content()
        result = self.client.post(f"/api/projects/{project['id']}/audio-scripts", json={'narrative_content_id':content['id']})
        self.assertEqual(result.status_code, 201)
        audio = result.json()
        self.assertNotIn('**', audio['script'])
        self.assertNotIn('https://', audio['script'])
        with patch.object(self.main, 'speech_chunk', return_value=(b'preview', 'test')):
            response = self.client.post('/api/audio-outputs/' + audio['id'] + '/synthesize', json={'preview':True})
        self.assertEqual(response.content, b'preview')
        self.assertFalse(self.client.get('/api/audio-outputs/' + audio['id']).json()['audio_available'])
        old_path = self.main.DATA_DIR / 'old.mp3'; old_path.write_bytes(b'old')
        with self.main.db() as conn:
            conn.execute("UPDATE audio_outputs SET audio_path=?, status='ready' WHERE id=?", (str(old_path), audio['id']))
        conn.close()
        self.assertEqual(self.client.put('/api/audio-outputs/' + audio['id'], json={'script':'修改后的稿件。'}).status_code, 200)
        self.assertFalse(old_path.exists())
        updated = self.client.get('/api/audio-outputs/' + audio['id']).json()
        self.assertFalse(updated['audio_available'])
        self.client.put('/api/narrative-contents/' + content['id'], json={'markdown':'更新后的正文', 'status':'needs_revision'})
        self.assertEqual(self.client.get('/api/audio-outputs/' + audio['id']).json()['status'], 'source_changed')
        result = self.client.post(f"/api/projects/{project['id']}/exports")
        self.assertEqual(result.status_code, 201)
        output = Path(result.json()['output_dir'])
        self.assertTrue((output / '讲稿-01.docx').is_file())
        self.assertTrue((output / '口播脚本-01.txt').is_file())
        evidence = json.loads((output / 'evidence-map.json').read_text())
        self.assertTrue(evidence[0]['section_sources'])

    def test_audio_script_falls_back_when_naturalization_model_is_unavailable(self):
        project, _, _, content = self.make_content()
        result = self.client.post(
            f"/api/projects/{project['id']}/audio-scripts",
            json={"narrative_content_id": content["id"], "naturalize": True},
        )
        self.assertEqual(result.status_code, 201)
        self.assertTrue(result.json()["naturalization_skipped"])
        self.assertFalse(result.json()["naturalized"])

    def test_tts_payloads_and_invalid_success_response(self):
        import httpx
        config = {'tts_provider':'minimax', 'tts_api_key':'secret', 'tts_speed':0.9}
        response = httpx.Response(200, json={'base_resp':{'status_code':0}, 'data':{'audio':b'mp3'.hex()}}, request=httpx.Request('POST','https://example.com'))
        with patch.object(httpx, 'post', return_value=response) as post:
            audio, model = self.main.speech_chunk('测试', config)
            self.assertEqual(audio, b'mp3')
            self.assertEqual(model, 'speech-2.8-hd')
            self.assertEqual(post.call_args.kwargs['json']['voice_setting']['speed'], 0.9)
            self.assertTrue(post.call_args.args[0].endswith('/t2a_v2'))
        with patch.object(httpx, 'post', return_value=response):
            with self.assertRaises(self.main.HTTPException):
                self.main.speech_chunk('test', {'tts_base_url':'https://example.com','tts_api_key':'secret'})

    def test_real_ffmpeg_merge_and_measured_duration(self):
        path = self.main.DATA_DIR / 'fixture.mp3'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-y',str(path)], check=True)
        script = ('这是测试句子。\n' * 400).strip()
        chunks = self.main.split_speech_text(script)
        self.assertEqual(''.join(chunks), script)
        self.assertTrue(all(len(chunk) <= 1200 for chunk in chunks))
        with patch.object(self.main, 'speech_chunk', return_value=(path.read_bytes(), 'fixture')):
            output, _, duration = self.main.synthesize_audio(script, 'test', {})
        self.assertTrue(output.is_file())
        self.assertGreaterEqual(duration, len(chunks))
        self.assertLessEqual(duration, len(chunks) + 1)
