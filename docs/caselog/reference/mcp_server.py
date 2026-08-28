#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Case-Log MCP server（Phase 1 主体）：knowledge.db 建库 3 表 + scenario_save 三段式 + timeline_read

架构红线（docs/case-log-v2-design v3.1，违反即返工）：
  - scenario_save 是唯一写入口，必经「人写草稿 → AI 后置校对 → 人确认」三段式，
    confirm 之前不落任何库（AI 产物永远是候选，可一键丢弃，不构成默认值）
  - 防粘贴闸门：草稿与转录相似度过高 / 整段照抄 → 拒绝，提示用自己的话重写（草稿可空但不可粘贴）
  - AI 全程后置且走本地/内网模型（R11）：OpenAI 兼容端点，env 配置；未配置时优雅跳过
  - 无检索：不提供 search / FTS / 向量 / 任何查询输入；timeline_read 只按日读（时间线唯一消费入口）
  - knowledge.db 3 张纯关系表，无虚表、无触发器；keywords 是展示字段，不建任何索引

数据布局（默认，可用 CASELOG_KB_ROOT 覆盖，如测试指向临时目录）：
  ~/.knowledge/knowledge.db                     3 表
  ~/.knowledge/normalized/YYYY-MM-DD/*.json     etl.py 产出的规范化会话流（只读引用）

stdio 传输：newline 分隔 JSON-RPC 2.0（MCP 2024-11-05 ~ 2025-06-18）。
Windows 下 stdin/stdout 强制 UTF-8；日志只走 stderr（CASELOG_DEBUG=1 时输出）。

用法：
  python mcp_server.py                # MCP server 模式（stdio）
  python mcp_server.py --init-db      # 仅建库（~/.knowledge/knowledge.db 3 表）
"""
import json
import os
import re
import sqlite3
import sys
import traceback
import urllib.request
import uuid as uuid_mod
from datetime import datetime

# ══════════════════ 配置（env 均可在 .mcp.json 的 env 段覆盖） ══════════════════

KB_ROOT = os.environ.get('CASELOG_KB_ROOT') or os.path.join(os.path.expanduser('~'), '.knowledge')
DB_PATH = os.path.join(KB_ROOT, 'knowledge.db')
NORMALIZED_ROOT = os.path.join(KB_ROOT, 'normalized')

PASTE_THRESHOLD = float(os.environ.get('CASELOG_PASTE_THRESHOLD', '0.6'))  # 🔶 架构默认值
LLM_BASE_URL = os.environ.get('CASELOG_LLM_BASE_URL', '').rstrip('/')      # OpenAI 兼容，如 http://localhost:11434/v1
LLM_MODEL = os.environ.get('CASELOG_LLM_MODEL', '')
LLM_API_KEY = os.environ.get('CASELOG_LLM_API_KEY', '')
LLM_TIMEOUT = float(os.environ.get('CASELOG_LLM_TIMEOUT', '120'))
AI_EXCERPT_CHARS = 6000   # AI 校对时附带的转录摘录上限
THINKING_CLIP = 500       # timeline_read include_turns 时 thinking 步截断
DEBUG = os.environ.get('CASELOG_DEBUG', '') == '1'

DDL = """
CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  edited_count INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS scenario_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT '',
  transcript_path TEXT NOT NULL DEFAULT '',
  seq_range TEXT NOT NULL DEFAULT '',
  noted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  recalled_note TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
"""


def log(*a):
    if DEBUG:
        print('[case-log]', *a, file=sys.stderr)


def now_iso():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def db():
    os.makedirs(KB_ROOT, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def ensure_db():
    """建库（幂等）：3 张纯关系表，无虚表无触发器，无额外索引（keywords 不建索引）"""
    con = db()
    try:
        con.executescript(DDL)
        con.commit()
    finally:
        con.close()


# ══════════════════ 规范化会话流定位（etl.py 产出，只读引用） ══════════════════

def _day_dirs():
    if not os.path.isdir(NORMALIZED_ROOT):
        return []
    return sorted((d for d in os.listdir(NORMALIZED_ROOT)
                   if re.match(r'^\d{4}-\d{2}-\d{2}$', d)), reverse=True)


def find_stream_files(session_id, agent_id='', date=None):
    """按 session_id（可选 agent_id / 日期）定位 normalized 流文件，返回相对 KB_ROOT 的路径列表"""
    rels = []
    days = [date] if date else _day_dirs()
    for d in days:
        day_dir = os.path.join(NORMALIZED_ROOT, d)
        if not os.path.isdir(day_dir):
            continue
        names = os.listdir(day_dir)
        hits = []
        if agent_id:
            exact = '%s__%s.json' % (session_id, agent_id[:24])
            hits = [exact] if exact in names else [n for n in names if n.startswith(session_id + '__')]
        else:
            main = session_id + '__main.json'
            hits = [main] if main in names else \
                sorted(n for n in names if n.startswith(session_id + '__'))
        for h in hits:
            rels.append('normalized/' + d + '/' + h)
    return rels


def load_stream(rel_path):
    """读一个规范化流 JSON（etl.py 产出结构）；找不到/损坏返回 None"""
    p = os.path.join(KB_ROOT, rel_path)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log('load_stream fail', rel_path, e)
        return None


def stream_text(rec):
    """流内全部文本（user / thinking / response / 工具名与摘要），供防粘贴闸门比对"""
    parts = []
    for t in rec.get('turns', []):
        parts.append(t.get('user') or '')
        for s in t.get('steps', []):
            parts.append(s.get('text') or '')
        parts.append(t.get('response') or '')
        for tl in t.get('tools', []):
            parts.append(tl.get('name') or '')
            parts.append(tl.get('summary') or '')
    return '\n'.join(p for p in parts if p)


# ══════════════════ 防粘贴闸门（R5 质量闸门，🔶 架构默认阈值 0.6） ══════════════════

def _norm(s):
    # 去标点/空白/大小写，保留字母数字与 CJK（\w 在 unicode 下含中文）
    return re.sub(r'[\W_]+', '', s.lower(), flags=re.UNICODE)


def _ngrams(s, n=3):
    return set(s[i:i + n] for i in range(len(s) - n + 1)) if len(s) >= n else ({s} if s else set())


def paste_gate(draft, pointer_rels):
    """草稿 vs 指针指向的转录文本。返回 dict：
    verdict: empty(草稿为空,放行) / no_transcript(无可比转录,放行) / pass / fail
    fail 条件：归一化后 ≥80 字整段出现在转录中，或 3-gram 包含度 ≥ PASTE_THRESHOLD
    """
    dn = _norm(draft or '')
    if not dn.strip():
        return {'verdict': 'empty', 'note': '草稿为空（规则：可空但不可粘贴；建议凭记忆先写）'}
    corpus = ''
    for rel in pointer_rels:
        rec = load_stream(rel)
        if rec:
            corpus += stream_text(rec) + '\n'
    cn = _norm(corpus)
    if not cn:
        return {'verdict': 'no_transcript', 'note': '指针未定位到转录，无比对基准（即时写入场景）'}
    dn_g, cn_g = _ngrams(dn), _ngrams(cn)
    sim = len(dn_g & cn_g) / max(1, len(dn_g))
    # 整篇照抄，或草稿中存在 ≥80 归一化字符的连续转录片段（60 字窗口/20 步进滑扫可保证命中）
    verbatim = dn in cn or any(
        dn[i:i + 60] in cn for i in range(0, max(0, len(dn) - 79), 20))
    gate = {'similarity': round(sim, 3), 'threshold': PASTE_THRESHOLD, 'verbatim_run': verbatim}
    if verbatim or sim >= PASTE_THRESHOLD:
        gate['verdict'] = 'fail'
        gate['note'] = '草稿与转录相似度过高——请合上转录，用自己的话重写（生成效应不可外包）'
    else:
        gate['verdict'] = 'pass'
    return gate


# ══════════════════ AI 后置校对（R11：本地/内网 LLM，OpenAI 兼容端点） ══════════════════

AI_SYSTEM = (
    '你是个人复盘工作台的校对助教。用户已凭自己的记忆写好情景草稿（标题+经验小结），'
    '你的职责是后置的：校对、润色文字，并参照附带的会话转录摘录补全事实细节。'
    '铁律：草稿中用户自己的判断和教训是核心，不得替换成转录原文；只修正错别字、补漏的事实、'
    '把口语理顺。输出严格的 JSON（不要 markdown 代码框），字段：\n'
    '{"title": "润色后的标题（≤30字）", "summary": "润色后的经验小结（保留用户原意，2~6句）",\n'
    ' "content": "完整情景，markdown，固定七段：## 症状 / ## 环境 / ## 排查过程（含弯路） / '
    '## 根因 / ## 修复 / ## 验证 / ## 经验小结",\n'
    ' "keywords": "3~6 个展示用关键词，逗号分隔（错误码/项目名/版本等，辅助再认，不用于检索）"}'
)


def llm_proofread(draft_title, draft_summary, excerpt):
    """调本地/内网 LLM 做后置校对。返回 (candidates_dict|None, err_msg|None)"""
    if not LLM_BASE_URL or not LLM_MODEL:
        return None, ('LLM 未配置（CASELOG_LLM_BASE_URL / CASELOG_LLM_MODEL）——'
                      '跳过 AI 环节属正常路径：AI 产物本就可丢弃，可直接进入 stage=confirm 用自己的草稿落库')
    user = ('【我的草稿】\n标题：%s\n经验小结：%s\n\n【会话转录摘录】\n%s\n\n'
            '请校对润色并按结构补全，输出严格 JSON。' %
            (draft_title, draft_summary, excerpt[:AI_EXCERPT_CHARS]))
    body = {'model': LLM_MODEL, 'stream': False, 'temperature': 0.3,
            'messages': [{'role': 'system', 'content': AI_SYSTEM},
                         {'role': 'user', 'content': user}]}
    headers = {'Content-Type': 'application/json'}
    if LLM_API_KEY:
        headers['Authorization'] = 'Bearer ' + LLM_API_KEY
    try:
        req = urllib.request.Request(LLM_BASE_URL + '/chat/completions',
                                     data=json.dumps(body).encode('utf-8'), headers=headers)
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        text = data['choices'][0]['message']['content']
    except Exception as e:
        return None, 'LLM 调用失败：%s —— 跳过 AI 环节，可直接 stage=confirm 用自己的草稿落库' % e
    m = re.search(r'\{.*\}', text, re.S)
    if not m:
        return None, 'LLM 返回不是 JSON——视为本次 AI 产物无效（可直接丢弃），可 stage=confirm 用草稿落库'
    try:
        c = json.loads(m.group(0))
        return {'title': str(c.get('title') or ''), 'summary': str(c.get('summary') or ''),
                'content': str(c.get('content') or ''), 'keywords': str(c.get('keywords') or '')}, None
    except Exception:
        return None, 'LLM 返回 JSON 解析失败——视为本次 AI 产物无效（可直接丢弃）'


# ══════════════════ 工具：scenario_save（唯一写入口，三段式） ══════════════════

class ToolError(Exception):
    pass


def _pointers_in(args):
    """入参 pointers → 规整列表；resolve transcript_path；收集 warnings"""
    out, warnings = [], []
    for p in (args.get('pointers') or []):
        sid = str(p.get('session_id') or '').strip()
        if not sid:
            warnings.append('pointer 缺 session_id，已跳过')
            continue
        aid = str(p.get('agent_id') or '').strip()
        seq = re.sub(r'\s', '', str(p.get('seq_range') or ''))
        if seq and not re.match(r'^\d+-\d+$', seq):
            warnings.append('seq_range "%s" 不是 "120-480" 格式，按原样保留' % seq)
        rels = find_stream_files(sid, aid, str(p.get('date') or '') or None)
        out.append({'session_id': sid, 'agent_id': aid, 'seq_range': seq,
                    'transcript_path': rels[0] if rels else ''})
        if not rels:
            warnings.append('session %s 未在 normalized/ 定位到流文件（先跑 etl.py；'
                            '指针悬空属预期降级，不影响落库）' % sid[:40])
    return out, warnings


def scenario_save_draft(args):
    """第一段：人凭记忆提交草稿 → 防粘贴闸门。不落库。"""
    draft_title = str(args.get('draft_title') or '').strip()
    draft_summary = str(args.get('draft_summary') or '').strip()
    if not draft_title and not draft_summary:
        raise ToolError('草稿为空：请先凭记忆写下标题与经验小结（哪怕粗糙），再调 stage=draft。'
                        '「人先写」不可外包给 AI。')
    rels = [p['transcript_path'] for p in _pointers_in(args)[0] if p['transcript_path']]
    gate = paste_gate(draft_title + '\n' + draft_summary, rels)
    r = {'stage': 'draft', 'gate': gate, 'saved': False}
    if gate['verdict'] == 'fail':
        r['next_step'] = '闸门拦截：请用自己的话重写草稿后重新 stage=draft（不要对照转录改写）'
    elif gate['verdict'] == 'empty':
        r['next_step'] = '草稿为空已放行，但强烈建议先写；随后可 stage=ai（AI 校对）或直接 stage=confirm'
    else:
        r['next_step'] = '闸门通过：进入 stage=ai（AI 后置校对，产物为候选可丢弃；LLM 未配置时自动跳过），' \
                         '或直接 stage=confirm 落库'
    return r


def scenario_save_ai(args):
    """第二段：AI 后置校对/润色/补全 + 建议 keywords → 全部为候选，不落库。LLM 不可用则跳过。"""
    draft_title = str(args.get('draft_title') or '').strip()
    draft_summary = str(args.get('draft_summary') or '').strip()
    if not draft_title and not draft_summary:
        raise ToolError('缺少草稿：三段式要求人先写（stage=draft），AI 只做后置校对。')
    ptrs, warnings = _pointers_in(args)
    rels = [p['transcript_path'] for p in ptrs if p['transcript_path']]
    gate = paste_gate(draft_title + '\n' + draft_summary, rels)
    if gate['verdict'] == 'fail':
        return {'stage': 'ai', 'saved': False, 'gate': gate,
                'next_step': '草稿疑似粘贴，AI 不为粘贴稿润色：请回 stage=draft 用自己的话重写'}
    excerpt = ''
    for rel in rels:
        rec = load_stream(rel)
        if rec:
            excerpt += stream_text(rec) + '\n'
    candidates, err = llm_proofread(draft_title, draft_summary, excerpt)
    r = {'stage': 'ai', 'saved': False, 'gate': gate, 'warnings': warnings}
    if candidates is None:
        r['ai_available'] = False
        r['note'] = err
        r['next_step'] = '跳过 AI：请人工把草稿整理为 title/content 后 stage=confirm 落库'
    else:
        r['ai_available'] = True
        r['candidates'] = candidates
        r['note'] = '以下全部是候选产物，未经你确认不落库；逐项采纳/修改/丢弃后 stage=confirm'
        r['next_step'] = '把确认后的 title / keywords / content（可参考或丢弃候选）连同 draft_* 一起提交 stage=confirm'
    return r


def scenario_save_confirm(args):
    """第三段：人确认后唯一落库点。草稿闸门复检，事务写 scenarios + scenario_sessions。"""
    title = str(args.get('title') or '').strip()
    content = str(args.get('content') or '').strip()
    if not title or not content:
        raise ToolError('title 与 content 必填（title 是回顾锚点，content 至少含经验小结）。')
    draft = (str(args.get('draft_title') or '').strip() + '\n' +
             str(args.get('draft_summary') or '').strip()).strip()
    ptrs, warnings = _pointers_in(args)
    if draft:
        rels = [p['transcript_path'] for p in ptrs if p['transcript_path']]
        gate = paste_gate(draft, rels)
        if gate['verdict'] == 'fail':
            return {'stage': 'confirm', 'saved': False, 'gate': gate,
                    'reason': '最终闸门拦截：人写草稿与转录高度相似，拒绝落库。'
                              '请回 stage=draft 凭记忆重写。'}
    else:
        gate = {'verdict': 'empty', 'note': '未携带 draft_*，无法复检闸门（正常流程应携带）'}
    source = str(args.get('source') or 'manual')
    if source not in ('manual', 'review'):
        raise ToolError('source 只允许 manual | review')
    keywords = str(args.get('keywords') or '').strip()
    category = str(args.get('category') or '').strip()
    now = now_iso()
    uid = str(uuid_mod.uuid4())
    con = db()
    try:
        con.execute('BEGIN')
        cur = con.execute(
            'INSERT INTO scenarios(uuid,title,keywords,content,category,source,'
            'edited_count,edited_at,created_at,updated_at,deleted_at) '
            "VALUES(?,?,?,?,?,?,0,NULL,?,?,NULL)",
            (uid, title, keywords, content, category, source, now, now))
        sid = cur.lastrowid
        for p in ptrs:
            con.execute(
                'INSERT INTO scenario_sessions(scenario_id,session_id,agent_id,'
                'transcript_path,seq_range,noted_at) VALUES(?,?,?,?,?,?)',
                (sid, p['session_id'], p['agent_id'], p['transcript_path'], p['seq_range'], now))
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return {'stage': 'confirm', 'saved': True, 'gate': gate, 'warnings': warnings,
            'scenario': {'id': sid, 'uuid': uid, 'title': title, 'keywords': keywords,
                         'category': category, 'source': source, 'created_at': now,
                         'pointers': ptrs},
            'next_step': '已落库，timeline_read(date=今日) 可见。编辑留痕（edited_count）Phase 2 提供'}


def tool_scenario_save(args):
    stage = str(args.get('stage') or '')
    if stage == 'draft':
        return scenario_save_draft(args)
    if stage == 'ai':
        return scenario_save_ai(args)
    if stage == 'confirm':
        return scenario_save_confirm(args)
    raise ToolError('stage 必须是 draft | ai | confirm（三段式：人写草稿 → AI 后置校对 → 人确认落库）')


# ══════════════════ 工具：timeline_read（时间线唯一消费入口的数据面） ══════════════════

def _scenario_row(con, row):
    sc = dict(row)
    sc['sessions'] = [dict(p) for p in con.execute(
        'SELECT session_id,agent_id,transcript_path,seq_range,noted_at '
        'FROM scenario_sessions WHERE scenario_id=? ORDER BY id', (row['id'],)).fetchall()]
    return sc


def _stream_meta(rec, rel):
    return {'file': rel, 'id': rec.get('id'), 'kind': rec.get('kind'),
            'session_id': rec.get('session_id'), 'agent_id': rec.get('agent_id'),
            'description': rec.get('description'), 'n_turns': rec.get('n_turns'),
            'tool_calls': (rec.get('stats') or {}).get('tool_calls'),
            'first_ts': (rec.get('stats') or {}).get('first_ts'),
            'last_ts': (rec.get('stats') or {}).get('last_ts')}


def _stream_turns(rec):
    turns = []
    for t in rec.get('turns', []):
        turns.append({
            'ts': t.get('ts'), 'user': t.get('user'), 'response': t.get('response'),
            'thinking': [(s.get('text') or '')[:THINKING_CLIP]
                         for s in t.get('steps', []) if s.get('type') == 'thinking'],
            'tools': [{'name': tl.get('name'), 'summary': tl.get('summary')}
                      for tl in t.get('tools', [])]})
    return turns


def tool_timeline_read(args):
    day = str(args.get('date') or '').strip() or datetime.now().strftime('%Y-%m-%d')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', day):
        raise ToolError('date 格式须为 YYYY-MM-DD')
    include_turns = bool(args.get('include_turns'))
    ensure_db()
    con = db()
    try:
        scenarios = [_scenario_row(con, r) for r in con.execute(
            "SELECT * FROM scenarios WHERE created_at LIKE ? AND deleted_at IS NULL "
            'ORDER BY created_at', (day + '%',)).fetchall()]
    finally:
        con.close()
    streams = []
    day_dir = os.path.join(NORMALIZED_ROOT, day)
    if os.path.isdir(day_dir):
        for name in sorted(os.listdir(day_dir)):
            if not name.endswith('.json'):
                continue
            rel = 'normalized/' + day + '/' + name
            rec = load_stream(rel)
            if not rec:
                continue
            meta = _stream_meta(rec, rel)
            if include_turns:
                meta['turns'] = _stream_turns(rec)
            streams.append(meta)
    return {'date': day, 'scenarios': scenarios, 'streams': streams,
            'note': '时间线按处理日分组；流文件由 etl.py 产出（只读）。无检索是设计红线（N5），'
                    '翻找即浏览。'}


# ══════════════════ MCP / JSON-RPC stdio ══════════════════

PROTOCOL_VERSIONS = ('2024-11-05', '2025-03-26', '2025-06-18')
LATEST = PROTOCOL_VERSIONS[-1]

TOOLS = [
    {
        'name': 'scenario_save',
        'description': (
            'case-log 唯一写入口（落情景库）。强制三段式，stage 区分：\n'
            '1) stage=draft：人凭记忆提交草稿（draft_title/draft_summary）+ 溯源指针（pointers），'
            '过防粘贴闸门（草稿与转录相似度过高会被拒）——不落库；\n'
            '2) stage=ai：AI 后置校对/润色/补全七段内容 + 建议 keywords，全部为候选不落库，'
            'LLM 未配置时自动跳过；\n'
            '3) stage=confirm：人逐项确认/修改候选后提交最终 title/keywords/content/category/source '
            '（必须携带 draft_* 供闸门复检），唯一落库点。\n'
            '禁止 AI 代写草稿，禁止跳过草稿直接 confirm（title/content 之外还须携带 draft_*）。'
            '本工具无任何查询能力（无检索是设计红线）。'),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'stage': {'type': 'string', 'enum': ['draft', 'ai', 'confirm'],
                          'description': '三段式阶段'},
                'draft_title': {'type': 'string', 'description': '人凭记忆写的标题草稿'},
                'draft_summary': {'type': 'string', 'description': '人凭记忆写的经验小结草稿'},
                'title': {'type': 'string', 'description': 'confirm：最终标题'},
                'keywords': {'type': 'string', 'description': 'confirm：展示用关键词，逗号分隔（不建索引不检索）'},
                'content': {'type': 'string', 'description': 'confirm：最终内容（markdown 七段：症状/环境/排查过程含弯路/根因/修复/验证/经验小结）'},
                'category': {'type': 'string', 'description': '可选分类'},
                'source': {'type': 'string', 'enum': ['manual', 'review'],
                           'description': 'manual=即时写入，review=回顾时新增（默认 manual）'},
                'pointers': {
                    'type': 'array',
                    'description': '溯源指针（R4/R10）：可多行并存，跨日追加=再加一行',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'session_id': {'type': 'string'},
                            'agent_id': {'type': 'string', 'description': 'subagent 子流 id，主流留空'},
                            'seq_range': {'type': 'string', 'description': '原始转录消息序号区间，如 120-480'},
                            'date': {'type': 'string', 'description': '流文件日期 YYYY-MM-DD（不填全库找）'}},
                        'required': ['session_id']}}
            },
            'required': ['stage'],
        },
    },
    {
        'name': 'timeline_read',
        'description': ('按日读取时间线（唯一消费入口的数据面）：当日情景（含溯源指针）'
                        ' + 当日规范化会话流元数据；include_turns=true 时附折叠渲染所需的'
                        ' turn 明细（user/最终回复/thinking 截断/工具目录）。只读，无检索。'),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'date': {'type': 'string', 'description': 'YYYY-MM-DD，默认今天'},
                'include_turns': {'type': 'boolean', 'description': '附会话流 turn 明细（渲染折叠用）'}},
        },
    },
]

SERVER_INFO = {'name': 'case-log', 'version': '1.0.0'}
INSTRUCTIONS = (
    'case-log 个人复盘工作台。scenario_save 是唯一写入口，必经「人写草稿→AI后置校对→人确认」'
    '三段式；timeline_read 按日读时间线。无检索工具、无自动捕获（设计红线 N1/N5）；'
    'AI 环节走本地/内网模型（R11）。')


def _send(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def _result(req_id, result):
    _send({'jsonrpc': '2.0', 'id': req_id, 'result': result})


def _error(req_id, code, message):
    _send({'jsonrpc': '2.0', 'id': req_id, 'error': {'code': code, 'message': message}})


def dispatch(method, params):
    """返回 result dict；notification 返回 None；未知方法抛 LookupError"""
    if method == 'initialize':
        asked = str((params or {}).get('protocolVersion') or '')
        ver = asked if asked in PROTOCOL_VERSIONS else LATEST
        return {'protocolVersion': ver, 'capabilities': {'tools': {}},
                'serverInfo': SERVER_INFO, 'instructions': INSTRUCTIONS}
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return {'tools': TOOLS}
    if method == 'tools/call':
        name = str((params or {}).get('name') or '')
        args = (params or {}).get('arguments') or {}
        if name == 'scenario_save':
            result = tool_scenario_save(args)
        elif name == 'timeline_read':
            result = tool_timeline_read(args)
        else:
            raise ValueError('unknown tool: %s（本 server 只提供 scenario_save / timeline_read，'
                             '无任何检索类工具）' % name)
        log('tool', name, 'ok')
        return {'content': [{'type': 'text', 'text': json.dumps(result, ensure_ascii=False, indent=1)}],
                'isError': False}
    if method == 'resources/list':
        return {'resources': []}
    if method == 'prompts/list':
        return {'prompts': []}
    raise LookupError('method not found: %s' % method)


NOTIFICATIONS = ('notifications/initialized', 'notifications/cancelled',
                 'notifications/progress', 'notifications/roots/list_changed')


def main():
    if '--init-db' in sys.argv:
        ensure_db()
        print('knowledge.db ready: %s (3 tables)' % DB_PATH)
        return
    # Windows stdio 默认可能是 gbk，MCP JSON 必须逐行 UTF-8
    sys.stdin.reconfigure(encoding='utf-8', errors='replace')
    sys.stdout.reconfigure(encoding='utf-8')
    log('started, kb=%s' % KB_ROOT)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except Exception as e:
            _error(None, -32700, 'parse error: %s' % e)
            continue
        method = msg.get('method')
        req_id = msg.get('id') if 'id' in msg else None
        is_notification = 'id' not in msg
        try:
            if method in NOTIFICATIONS:
                continue
            result = dispatch(method, msg.get('params') or {})
            if not is_notification:
                _result(req_id, result)
        except LookupError as e:
            if not is_notification:
                _error(req_id, -32601, str(e))
        except ValueError as e:
            if not is_notification:
                _error(req_id, -32602, str(e))
        except ToolError as e:
            if not is_notification:
                _send({'jsonrpc': '2.0', 'id': req_id, 'result': {
                    'content': [{'type': 'text', 'text': '参数错误：%s' % e}], 'isError': True}})
        except Exception as e:
            log(traceback.format_exc())
            if not is_notification:
                _send({'jsonrpc': '2.0', 'id': req_id, 'result': {
                    'content': [{'type': 'text', 'text': '内部错误：%s' % e}], 'isError': True}})
    log('exiting')


if __name__ == '__main__':
    main()
