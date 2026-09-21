"""Regression coverage for profiles, source boundaries, audio and exports."""
import json
import os
import sqlite3
import subprocess
import sys
import types
import unittest
from unittest.mock import patch
from pathlib import Path
from xml.etree import ElementTree as ET

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

    def test_provider_error_message_explains_openai_quota(self):
        message = self.main.provider_error_message('{"error":{"code":"credit_balance_exhausted","message":"You have no credits remaining"}}')
        self.assertIn('额度不足', message)
        self.assertNotIn('credit_balance_exhausted', message)

    def test_version_endpoint_reports_public_release_update(self):
        import httpx
        response = httpx.Response(
            200,
            json={
                'tag_name': 'v0.2.0',
                'html_url': 'https://github.com/donghyq/lawflow-releases/releases/tag/v0.2.0',
            },
            request=httpx.Request('GET', 'https://api.github.com/repos/donghyq/lawflow-releases/releases/latest'),
        )
        with patch.object(self.main.httpx, 'get', return_value=response):
            result = self.client.get('/api/app/version')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['current_version'], '0.1.0')
        self.assertEqual(result.json()['latest_version'], '0.2.0')
        self.assertTrue(result.json()['update_available'])
        self.assertTrue(result.json()['check_succeeded'])
        self.assertEqual(self.client.get('/api/health').json()['version'], '0.1.0')

    def test_version_check_failure_never_blocks_local_app(self):
        import httpx
        with patch.object(self.main.httpx, 'get', side_effect=httpx.ConnectError('offline')):
            result = self.client.get('/api/app/version')
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['update_available'])
        self.assertFalse(result.json()['check_succeeded'])

    def test_existing_database_is_backed_up_before_first_schema_migration(self):
        import sqlite3
        legacy_dir = self.temp_dir / 'legacy-upgrade'
        legacy_dir.mkdir()
        legacy_db = legacy_dir / 'app.db'
        with sqlite3.connect(legacy_db) as conn:
            conn.execute("CREATE TABLE legacy_marker (value TEXT)")
            conn.execute("INSERT INTO legacy_marker VALUES ('keep-me')")
        with patch.object(self.main, 'DATA_DIR', legacy_dir), patch.object(self.main, 'DB_PATH', legacy_db):
            self.main.init_db()
            backups = list((legacy_dir / 'backups').glob('app-before-schema-*.db'))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as conn:
            self.assertEqual(conn.execute('SELECT value FROM legacy_marker').fetchone()[0], 'keep-me')

    def test_chatgpt_mcp_exposes_core_lawflow_tools(self):
        import asyncio
        tools = asyncio.run(self.main.chatgpt_mcp.list_tools())
        names = {tool.name for tool in tools}
        self.assertTrue({
            'list_lawflow_projects', 'add_lawflow_text_source', 'get_lawflow_source_context',
            'confirm_lawflow_structure', 'update_lawflow_verification_task',
            'save_lawflow_chatgpt_draft', 'create_lawflow_daily_brief', 'export_lawflow_project',
        }.issubset(names))

    def test_chatgpt_mcp_route_requires_deployment_token(self):
        old = os.environ.pop('LAWFLOW_MCP_TOKEN', None)
        try:
            response = self.client.post('/mcp/', json={'jsonrpc':'2.0','id':1,'method':'initialize','params':{}})
            self.assertEqual(response.status_code, 503)
        finally:
            if old is not None:
                os.environ['LAWFLOW_MCP_TOKEN'] = old

    def test_chatgpt_app_handoff_only_returns_selected_source_blocks(self):
        project = self.client.post('/api/projects', json={'name':'Plus 协作','scenario':'daily_brief','transform_mode':'condense','verification_mode':'source_only'}).json()
        source = self.client.post(f"/api/projects/{project['id']}/text-sources", json={'title':'素材','content':'监管部门发布了新的数据合规提示，企业需要关注适用范围和实施时间。'}).json()
        document = self.client.get('/api/documents/' + source['id']).json()
        source_ids = [block['id'] for block in document['blocks'] if block['kind'] == 'paragraph']
        result = self.client.post(f"/api/projects/{project['id']}/chatgpt-handoff", json={'document_id':source['id'],'title':'五分钟速听','source_block_ids':source_ids})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['source_block_ids'], source_ids)
        self.assertIn('唯一材料', result.json()['prompt'])
        self.assertNotIn('API Key', result.json()['prompt'])

    def test_desktop_launcher_uses_an_available_port(self):
        from scripts import lawflow_desktop
        import socket
        original = lawflow_desktop.os.environ.get('LAWFLOW_PORT')
        lawflow_desktop.os.environ['LAWFLOW_PORT'] = '18081'
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(('127.0.0.1', 18081))
                listener.listen(1)
                with self.assertRaises(RuntimeError):
                    lawflow_desktop.choose_port()
        finally:
            if original is None:
                lawflow_desktop.os.environ.pop('LAWFLOW_PORT', None)
            else:
                lawflow_desktop.os.environ['LAWFLOW_PORT'] = original

    def test_desktop_launcher_migrates_legacy_projects_only_into_empty_data_dir(self):
        from scripts import lawflow_desktop
        legacy = self.temp_dir / 'legacy-data'
        target = self.temp_dir / 'desktop-data'
        legacy.mkdir()
        target.mkdir()
        with sqlite3.connect(legacy / 'app.db') as conn:
            conn.execute('CREATE TABLE projects (id TEXT)')
            conn.execute("INSERT INTO projects VALUES ('legacy-project')")
        (legacy / 'projects').mkdir()
        (legacy / 'projects' / 'note.txt').write_text('legacy', encoding='utf-8')
        self.assertTrue(lawflow_desktop.migrate_legacy_data(target, legacy))
        self.assertTrue((target / 'projects' / 'note.txt').is_file())
        self.assertFalse(lawflow_desktop.migrate_legacy_data(target, legacy))

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

    def test_outline_prompt_uses_actual_source_ids_not_legacy_placeholder(self):
        request = self.main.NarrativeOutlineRequest(document_id='d', title='测试', source_block_ids=['actual:paragraph'], transform_mode='condense', target_duration=3)
        blocks = [{'id':'actual:paragraph', 'kind':'paragraph', 'text':'材料正文', 'source_locator':'段落 1'}]
        raw = {'sections':[{'heading':'问题','source_block_ids':['actual:paragraph']}]}
        with patch.object(self.main, 'model_chat', return_value=json.dumps(raw)) as model:
            self.main.create_narrative_outline(request, blocks)
        prompt = model.call_args.args[0][-1]['content']
        self.assertIn('actual:paragraph', prompt)
        self.assertNotIn('b-00001', prompt)

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

    def test_project_deletion_removes_managed_audio_file(self):
        project, _, _, content = self.make_content()
        audio = self.client.post(
            f"/api/projects/{project['id']}/audio-scripts",
            json={'narrative_content_id': content['id']},
        ).json()
        audio_dir = self.main.DATA_DIR / 'audio'
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_path = audio_dir / 'managed-output.mp3'
        audio_path.write_bytes(b'audio')
        with self.main.db() as conn:
            conn.execute(
                "UPDATE audio_outputs SET audio_path=?, status='ready' WHERE id=?",
                (str(audio_path), audio['id']),
            )
        self.assertTrue(audio_path.exists())
        self.assertEqual(self.client.delete('/api/projects/' + project['id']).status_code, 204)
        self.assertFalse(audio_path.exists())

    def test_external_verification_blocks_narrative_and_unconfirmed_audio_blocks_full_mp3(self):
        project = self.client.post('/api/projects', json={'name':'对外内容','scenario':'legal_podcast','transform_mode':'enrich','verification_mode':'external_verify'}).json()
        source = self.client.post(f"/api/projects/{project['id']}/text-sources", json={'title':'素材','content':'企业应当核验跨境数据传输、责任主体和备案要求。'}).json()
        document = self.client.get('/api/documents/' + source['id']).json()
        ids = [block['id'] for block in document['blocks'] if block['kind'] == 'paragraph']
        blocked = self.client.post(f"/api/projects/{project['id']}/skill-host-contents", json={'document_id':source['id'],'title':'播客稿','markdown':'# 播客稿\n\n正文。','source_block_ids':ids})
        self.assertEqual(blocked.status_code, 409)
        plan = self.client.post(f"/api/projects/{project['id']}/plans", json={'source_document_id':source['id']}).json()
        self.client.put(f"/api/plans/{plan['id']}/confirm", json={'chapters':plan['chapters']})
        state = self.client.get('/api/projects/' + project['id']).json()
        for task in state['tasks']:
            self.client.put('/api/tasks/' + task['id'], json={'status':'done'})
        content = self.client.post(f"/api/projects/{project['id']}/skill-host-contents", json={'document_id':source['id'],'title':'播客稿','markdown':'# 播客稿\n\n正文。','source_block_ids':ids}).json()
        audio = self.client.post(f"/api/projects/{project['id']}/audio-scripts", json={'narrative_content_id':content['id']}).json()
        self.assertEqual(self.client.post('/api/audio-outputs/' + audio['id'] + '/synthesize', json={}).status_code, 409)
        with patch.object(self.main, 'speech_chunk', return_value=(b'preview', 'test')):
            self.assertEqual(self.client.post('/api/audio-outputs/' + audio['id'] + '/synthesize', json={'preview':True}).status_code, 200)

    def test_daily_brief_subscription_collects_new_rss_items_once(self):
        xml = ET.fromstring('''<rss><channel><item><guid>one</guid><title>监管动态一</title><link>https://example.com/one</link><description>第一篇资讯正文，包含必要的法律规则说明。</description></item><item><guid>two</guid><title>监管动态二</title><link>https://example.com/two</link><description>第二篇资讯正文，包含必要的合规事项说明。</description></item></channel></rss>''')
        with patch.object(self.main.httpx, 'get') as get:
            response = type('Response', (), {'content': ET.tostring(xml), 'raise_for_status': lambda self: None})()
            get.return_value = response
            subscription = self.client.post('/api/daily-brief-subscriptions', json={'name':'监管资讯','feed_url':'https://example.com/feed.xml','daily_time':'08:00','max_items':2})
            self.assertEqual(subscription.status_code, 201)
            first = self.client.post('/api/daily-brief-subscriptions/' + subscription.json()['id'] + '/run')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['new_item_count'], 2)
            self.assertTrue(first.json()['project_id'])
            second = self.client.post('/api/daily-brief-subscriptions/' + subscription.json()['id'] + '/run')
            self.assertEqual(second.json()['new_item_count'], 0)

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

    def test_macos_say_tts_uses_local_voice_without_api_key(self):
        with patch.object(self.main.sys, 'platform', 'darwin'), patch.object(self.main.shutil, 'which', return_value='/usr/bin/say'), patch.object(self.main.subprocess, 'run') as run:
            def make_output(args, **_kwargs):
                target = Path(args[-1])
                target.write_bytes(b'mp3')
                return subprocess.CompletedProcess(args, 0)
            run.side_effect = make_output
            audio, provider = self.main.speech_chunk('本地语音测试。', {'tts_provider':'macos_say','tts_voice':'Tingting','tts_speed':1})
        self.assertEqual(audio, b'mp3')
        self.assertEqual(provider, 'macos-say:Tingting')

    def test_edge_tts_uses_configured_voice_without_api_key(self):
        class FakeCommunicate:
            def __init__(self, text, voice, rate):
                self.voice = voice
                self.rate = rate

            async def save(self, path):
                Path(path).write_bytes(b'edge-mp3')

        fake_module = types.SimpleNamespace(Communicate=FakeCommunicate)
        with patch.object(self.main, 'edge_tts', fake_module):
            audio, provider = self.main.speech_chunk(
                '在线语音测试。',
                {'tts_provider': 'edge_tts', 'tts_voice': 'zh-CN-XiaoxiaoNeural', 'tts_speed': 1},
            )
        self.assertEqual(audio, b'edge-mp3')
        self.assertEqual(provider, 'edge-tts:zh-CN-XiaoxiaoNeural')

    def test_tts_settings_preview_does_not_require_text_model(self):
        with patch.object(self.main, 'get_internal_provider_settings', return_value={'tts_provider': 'edge_tts'}), patch.object(self.main, 'speech_chunk', return_value=(b'preview-mp3', 'edge-tts:test')):
            response = self.client.post('/api/settings/tts/test')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'preview-mp3')
        self.assertEqual(response.headers['content-type'], 'audio/mpeg')

    def test_web_search_requires_explicit_import_and_preserves_source(self):
        import httpx
        project = self.client.post('/api/projects', json={'name': '人工智能治理', 'scenario': 'topic_learning'}).json()
        search_response = httpx.Response(
            200,
            content='''<rss><channel><item><title>人工智能治理公开监管动态</title><link>https://example.com/news</link><description>&lt;b&gt;人工智能治理公开摘要&lt;/b&gt;</description></item></channel></rss>'''.encode('utf-8'),
            request=httpx.Request('GET', 'https://www.bing.com/search'),
        )
        with patch.object(self.main.httpx, 'get', return_value=search_response):
            search = self.client.post('/api/web-search', json={'query': '人工智能治理'})
        self.assertEqual(search.status_code, 200)
        self.assertEqual(len(search.json()['results']), 1)
        self.assertEqual(self.client.get('/api/projects/' + project['id']).json()['documents'], [])

        page_response = httpx.Response(
            200,
            headers={'content-type': 'text/html; charset=utf-8'},
            text='<html><head><script>ignored()</script></head><body><h1>公开监管动态</h1><p>' + ('正文内容。' * 40) + '</p></body></html>',
            request=httpx.Request('GET', 'https://example.com/news'),
        )
        with patch.object(self.main.httpx, 'get', return_value=page_response):
            imported = self.client.post('/api/projects/' + project['id'] + '/web-sources', json={'title': '公开监管动态', 'url': 'https://example.com/news'})
        self.assertEqual(imported.status_code, 201)
        document = self.client.get('/api/documents/' + imported.json()['id']).json()
        self.assertEqual(document['source_url'], 'https://example.com/news')
        self.assertNotIn('ignored()', ' '.join(item['text'] for item in document['blocks']))
        blocked = self.client.post('/api/projects/' + project['id'] + '/web-sources', json={'title': '本机', 'url': 'http://127.0.0.1:8080/'})
        self.assertEqual(blocked.status_code, 400)

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