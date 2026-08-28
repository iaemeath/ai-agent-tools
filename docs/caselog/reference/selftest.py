#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Case-Log Phase 1 自测：建库 / 防粘贴闸门 / scenario_save 三段式 / timeline_read / MCP 协议握手

全部在临时 KB_ROOT（CASELOG_KB_ROOT 指向临时目录）中运行，不触碰真实 ~/.knowledge。
运行：python selftest.py
"""
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='case-log-selftest-')
os.environ['CASELOG_KB_ROOT'] = TMP  # 必须在 import mcp_server 之前设置（模块读 env 初始化）
os.environ.pop('CASELOG_LLM_BASE_URL', None)
os.environ.pop('CASELOG_LLM_MODEL', None)
sys.path.insert(0, ROOT)
import mcp_server as m  # noqa: E402

DAY = '2026-08-28'
SID = 'sess_selftest0000-0000-0000'
LONG_FACT = ('这次排查绕了弯路：先怀疑内存不足重启了两次服务，又回滚了版本，折腾一个小时无果；'
             '最后才用 netstat 按 PID 反查，发现是昨晚崩掉的旧 java 进程没退干净占着 8080，'
             'taskkill 掉立刻恢复——教训是端口类问题第一步就该查占用，别急着改应用层。')

TRANSCRIPT = {
    'id': SID + '__main', 'kind': 'main', 'session_id': SID, 'agent_id': '',
    'description': '自测：端口被占排障', 'n_turns': 2,
    'stats': {'rows': 12, 'tool_calls': 2,
              'first_ts': DAY + 'T10:00:00+08:00', 'last_ts': DAY + 'T10:30:00+08:00'},
    'turns': [
        {'ts': DAY + 'T10:00:00+08:00',
         'user': '服务起不来，报端口被占',
         'response': '查到 8080 被一个残留 java 进程占用，PID 4321，taskkill 后服务正常启动',
         'steps': [{'type': 'thinking', 'text': '先看 netstat'},
                   {'type': 'text', 'text': '中间过程输出'}],
         'tools': [{'name': 'Bash', 'summary': 'netstat -ano | grep 8080', 'input': '{}'}]},
        {'ts': DAY + 'T10:20:00+08:00',
         'user': '还是不行，换了端口也不行',
         'response': LONG_FACT,
         'steps': [], 'tools': []},
    ],
}


def make_stream():
    d = os.path.join(TMP, 'normalized', DAY)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, SID + '__main.json'), 'w', encoding='utf-8') as f:
        json.dump(TRANSCRIPT, f, ensure_ascii=False)


PTR = [{'session_id': SID, 'date': DAY}]
REL = 'normalized/' + DAY + '/' + SID + '__main.json'

make_stream()  # 模块级执行：伪造一条规范化会话流，供闸门/时间线/流程用例使用


class TestDb(unittest.TestCase):
    def test_ensure_db_3_tables(self):
        m.ensure_db()
        con = m.db()
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        con.close()
        self.assertTrue({'scenarios', 'scenario_sessions', 'review_log'} <= names)


class TestGate(unittest.TestCase):
    def test_verbatim_paste_rejected(self):
        g = m.paste_gate('排障记录：' + LONG_FACT, [REL])
        self.assertEqual(g['verdict'], 'fail')
        self.assertTrue(g['verbatim_run'])

    def test_heavy_copy_rejected(self):
        # 打乱转录句序的高相似拼贴
        g = m.paste_gate(LONG_FACT[:60] + '。另外，' + LONG_FACT[60:130],
                         [REL])
        self.assertEqual(g['verdict'], 'fail')

    def test_own_words_pass(self):
        g = m.paste_gate('端口类故障第一步查占用，别急着改应用层；崩掉的进程要按 PID 清理。',
                         [REL])
        self.assertEqual(g['verdict'], 'pass')
        self.assertLess(g['similarity'], m.PASTE_THRESHOLD)

    def test_empty_draft_allowed_but_flagged(self):
        g = m.paste_gate('', [REL])
        self.assertEqual(g['verdict'], 'empty')

    def test_no_transcript_allowed(self):
        g = m.paste_gate('随便写点什么，够长一点，没有转录可比。' * 3, [])
        self.assertEqual(g['verdict'], 'no_transcript')


class TestFlow(unittest.TestCase):
    def test_full_three_stage_flow(self):
        r1 = m.tool_scenario_save({'stage': 'draft', 'draft_title': '端口被占排障',
                                   'draft_summary': '端口类故障第一步查占用；崩掉的进程要按 PID 清理。',
                                   'pointers': PTR})
        self.assertEqual(r1['gate']['verdict'], 'pass')
        self.assertFalse(r1['saved'])

        r2 = m.tool_scenario_save({'stage': 'ai', 'draft_title': '端口被占排障',
                                   'draft_summary': '端口类故障第一步查占用。',
                                   'pointers': PTR})
        self.assertFalse(r2['ai_available'])  # LLM 未配置 → 优雅跳过
        self.assertIn('confirm', r2['next_step'])

        r3 = m.tool_scenario_save({
            'stage': 'confirm', 'title': '端口被占排障：残留进程按 PID 清理',
            'keywords': '端口占用,netstat,taskkill,8080',
            'content': '## 症状\n服务起不来\n## 经验小结\n端口类故障第一步查占用',
            'draft_title': '端口被占排障',
            'draft_summary': '端口类故障第一步查占用；崩掉的进程要按 PID 清理。',
            'pointers': PTR})
        self.assertTrue(r3['saved'], r3)
        sid = r3['scenario']['id']

        con = m.db()
        sc = con.execute('SELECT * FROM scenarios WHERE id=?', (sid,)).fetchone()
        ptr = con.execute('SELECT * FROM scenario_sessions WHERE scenario_id=?', (sid,)).fetchone()
        con.close()
        self.assertEqual(sc['title'], '端口被占排障：残留进程按 PID 清理')
        self.assertEqual(sc['edited_count'], 0)
        self.assertIsNone(sc['deleted_at'])
        self.assertEqual(ptr['transcript_path'], REL)
        self.assertEqual(ptr['session_id'], SID)

    def test_confirm_rejects_pasted_draft(self):
        r = m.tool_scenario_save({
            'stage': 'confirm', 'title': '抄来的记录', 'content': '内容',
            'draft_title': '记录', 'draft_summary': LONG_FACT, 'pointers': PTR})
        self.assertFalse(r['saved'])
        self.assertEqual(r['gate']['verdict'], 'fail')

    def test_confirm_requires_title_and_content(self):
        with self.assertRaises(m.ToolError):
            m.tool_scenario_save({'stage': 'confirm', 'title': '', 'content': ''})

    def test_invalid_stage(self):
        with self.assertRaises(m.ToolError):
            m.tool_scenario_save({'stage': 'auto'})

    def test_pointer_dangling_ok(self):
        r = m.tool_scenario_save({
            'stage': 'confirm', 'title': '指针悬空', 'content': '内容',
            'draft_title': '指针悬空', 'draft_summary': '没有转录可比的即时写入场景。',
            'pointers': [{'session_id': 'sess_not_exist'}]})
        self.assertTrue(r['saved'])
        self.assertTrue(any('未在 normalized' in w for w in r['warnings']))


class TestTimeline(unittest.TestCase):
    def test_timeline_read(self):
        r = m.tool_timeline_read({'date': DAY})
        self.assertEqual(len(r['scenarios']), 2)
        sc = r['scenarios'][0]
        self.assertTrue(sc['sessions'])                       # 溯源指针随行
        self.assertEqual(sc['sessions'][0]['session_id'], SID)
        self.assertEqual(len(r['streams']), 1)
        self.assertEqual(r['streams'][0]['session_id'], SID)
        self.assertNotIn('turns', r['streams'][0])

        r2 = m.tool_timeline_read({'date': DAY, 'include_turns': True})
        t = r2['streams'][0]['turns'][0]
        self.assertIn('taskkill', t['response'])
        self.assertEqual(t['tools'][0]['name'], 'Bash')
        self.assertTrue(t['thinking'])

    def test_timeline_read_empty_day(self):
        r = m.tool_timeline_read({'date': '2000-01-01'})
        self.assertEqual(r['scenarios'], [])
        self.assertEqual(r['streams'], [])

    def test_bad_date(self):
        with self.assertRaises(m.ToolError):
            m.tool_timeline_read({'date': '20260828'})


class TestProtocol(unittest.TestCase):
    """子进程起真 server，走一遍 JSON-RPC/MCP stdio 握手"""

    @classmethod
    def setUpClass(cls):
        env = os.environ.copy()
        env['CASELOG_KB_ROOT'] = TMP
        cls.p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'mcp_server.py')],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, env=env,
                                 text=True, encoding='utf-8')
        cls.q = queue.Queue()
        threading.Thread(target=lambda: [cls.q.put(l) for l in cls.p.stdout],
                         daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.p.stdin.close()
        except Exception:
            pass
        cls.p.wait(timeout=5)

    def rpc(self, obj):
        self.p.stdin.write(json.dumps(obj) + '\n')
        self.p.stdin.flush()
        return json.loads(self.q.get(timeout=20))

    def test_handshake_and_tools(self):
        r = self.rpc({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                      'params': {'protocolVersion': '2025-06-18',
                                 'capabilities': {}, 'clientInfo': {'name': 'selftest'}}})
        self.assertEqual(r['result']['protocolVersion'], '2025-06-18')
        self.assertEqual(r['result']['serverInfo']['name'], 'case-log')

        r = self.rpc({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'})
        names = {t['name'] for t in r['result']['tools']}
        self.assertEqual(names, {'scenario_save', 'timeline_read'})

        r = self.rpc({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                      'params': {'name': 'timeline_read',
                                 'arguments': {'date': DAY, 'include_turns': True}}})
        self.assertFalse(r['result']['isError'])
        payload = json.loads(r['result']['content'][0]['text'])
        self.assertEqual(len(payload['scenarios']), 2)

        r = self.rpc({'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
                      'params': {'name': 'scenario_save',
                                 'arguments': {'stage': 'draft', 'draft_title': '协议层冒烟',
                                               'draft_summary': '从 stdin 走一遍 draft 段。',
                                               'pointers': PTR}}})
        payload = json.loads(r['result']['content'][0]['text'])
        self.assertEqual(payload['stage'], 'draft')

        r = self.rpc({'jsonrpc': '2.0', 'id': 5, 'method': 'no/such'})
        self.assertEqual(r['error']['code'], -32601)

    def test_unknown_tool_is_error(self):
        r = self.rpc({'jsonrpc': '2.0', 'id': 6, 'method': 'tools/call',
                      'params': {'name': 'search', 'arguments': {'q': 'x'}}})
        self.assertEqual(r.get('error', {}).get('code'), -32602)  # 无检索是红线：server 上不存在查询工具


if __name__ == '__main__':
    print('临时 KB_ROOT: %s' % TMP)
    unittest.main(verbosity=2)
