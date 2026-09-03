// caselog llm — AI-post polish (R5: human first, AI second, candidates only).
//
// Calls an OpenAI-compatible chat endpoint configured via env:
//   CASELOG_LLM_BASE_URL  e.g. http://127.0.0.1:8000/v1   (required, minus /chat/completions)
//   CASELOG_LLM_MODEL     model name                       (required)
//   CASELOG_LLM_API_KEY   bearer token                     (optional; some local servers ignore it)
// When unconfigured, polishDraft reports { configured: false } and the route answers 400 —
// the UI keeps working purely human-written (graceful skip per v3.3 §4).
//
// The result is ALWAYS a candidate: the caller renders it next to the human draft and
// only merges fields the user explicitly adopts. Nothing here writes knowledge.db.

const TIMEOUT_MS = 60_000;
/** Hard cap on the session transcript sent to the model (chars) — the client already
 * folds long sessions; this is just a runaway guard. */
const CONTEXT_MAX_CHARS = 30_000;

export interface PolishDraft {
	title: string;
	keywords: string;
	content: string;
}

export interface PolishResult {
	configured: boolean;
	error?: string;
	candidate?: PolishDraft;
}

interface ChatChoice {
	message?: { content?: string };
}

export function llmConfigured(): boolean {
	return Boolean(process.env['CASELOG_LLM_BASE_URL'] && process.env['CASELOG_LLM_MODEL']);
}

/** Ask the model to proofread a human draft against the session excerpt. */
export async function polishDraft(draft: PolishDraft, context: string): Promise<PolishResult> {
	const baseUrl = process.env['CASELOG_LLM_BASE_URL'];
	const model = process.env['CASELOG_LLM_MODEL'];
	const apiKey = process.env['CASELOG_LLM_API_KEY'];
	if (!baseUrl || !model) return { configured: false, error: 'llm not configured' };

	const excerpt = context.length > CONTEXT_MAX_CHARS ? context.slice(0, CONTEXT_MAX_CHARS) + '\n…（截断）' : context;
	const system = [
		'你是个人复盘系统的校对助手。用户已凭记忆写好情景记录草稿，你的任务是校对与补全，不是代写。',
		'基于"原始会话摘录"核对事实、修正措辞、补全结构（症状/环境/排查弯路/根因/修复/验证/经验小结）。',
		'保留用户草稿的语气与第一人称视角；会话摘录里没有的细节不要编造。',
		'keywords 是展示用的检索提示（错误码/项目名/版本），逗号分隔。',
		'只输出一个 JSON 对象：{"title": string, "keywords": string, "content": string}，不要输出其他任何文字。',
	].join('\n');
	// Prompt order matters for prompt-cache hits: stable prefix first (system + the
	// session transcript, which is append-only and thus prefix-stable across re-polishes
	// of the same session), mutable part last (the draft). With the draft first, the
	// transcript tokens would never hit the cache.
	const user = [
		'【原始会话】（规范化全文，供核对事实）',
		excerpt || '（未提供会话内容，仅校对措辞与结构）',
		'',
		'【我的草稿】',
		`标题：${draft.title}`,
		`关键词：${draft.keywords}`,
		`内容：\n${draft.content}`,
	].join('\n');

	const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			temperature: 0.3,
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) {
		return { configured: true, error: `llm http ${res.status}: ${(await res.text()).slice(0, 200)}` };
	}
	const data = (await res.json()) as { choices?: ChatChoice[] };
	const text = data.choices?.[0]?.message?.content ?? '';
	const candidate = parseCandidate(text);
	if (!candidate) return { configured: true, error: 'llm returned non-JSON content' };
	return { configured: true, candidate };
}

/** Tolerant JSON extraction: accepts bare objects or ```json fenced blocks. */
function parseCandidate(text: string): PolishDraft | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = (fenced ? fenced[1] : text).trim();
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
		const title = String(obj['title'] ?? '').trim();
		const content = String(obj['content'] ?? '').trim();
		if (!title || !content) return null;
		return { title, content, keywords: String(obj['keywords'] ?? '').trim() };
	} catch {
		return null;
	}
}
