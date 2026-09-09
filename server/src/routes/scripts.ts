// Script routes — 脚本（卡片）管理，薄壳模型：控制台只有 启动/查看状态/关闭 三个操作，
// 页面与页面内的全部交互归脚本自己。服务端负责：卡片列表、新建（多文件一次录入，ID 自动生成）、
// 删除、启停（按清单参数）、页面静态伺服（/scripts-pages/*）、页面网关代理（/api/scripts/:id/proxy/*）。
// 全部为本地操作，不走 hostMiddleware 的远程主机上下文。

import { Hono } from 'hono';
import { proxy } from 'hono/proxy';
import fs from 'node:fs';
import path from 'node:path';
import {
	listFiles, listScriptIds, readManifest, runtimeCmd, safeJoin, scriptDir,
	SCRIPT_ID_RE, type ScriptArgs, type ScriptEntrySpec, type ScriptManifest,
} from '../scripts/store.js';
import { logOf, runShort, startProc, statusOf, stopProc } from '../scripts/procman.js';

export const scripts = new Hono();

interface ScriptCard {
	id: string;
	name: string;
	desc?: string;
	ui?: string | null;
	proxyTarget?: string | null;
	order?: number;
	entry: ScriptEntrySpec | null;
	/** 三键参数（客户端据此禁用没有参数的按钮）。 */
	args: ScriptArgs;
	/** 服务型工具（detached 常驻拉起）。 */
	detached: boolean;
	/** 该脚本唯一进程的实时状态。 */
	status: ReturnType<typeof statusOf>;
}

function toCard(id: string, m: ScriptManifest): ScriptCard {
	return {
		id,
		name: m.name,
		desc: m.desc,
		ui: m.ui ?? null,
		proxyTarget: m.proxyTarget ?? null,
		order: m.order,
		entry: m.entry ?? null,
		args: m.args ?? {},
		detached: !!m.detached,
		status: statusOf(id),
	};
}

const err = (c: any, code: number, msg: string) => c.json({ error: msg }, code as 400);

/* ===================== 卡片列表 / 新建 / 删除 ===================== */

/** GET /api/scripts */
scripts.get('/', (c) => {
	const out = listScriptIds().map((id) => {
		let m: ScriptManifest;
		try {
			m = readManifest(id);
		} catch {
			m = { id, name: id, desc: '（script.json 损坏或不可读）', entry: null, args: {} };
		}
		return toCard(id, m);
	});
	out.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id));
	return c.json(out);
});

/** POST /api/scripts/import — 从现成目录导入（整目录复制到 scripts/），AI 写好的工具一条命令注册。
 *  body: { dir } ；源目录已含 script.json 则沿用（id 重写），否则推断最小清单（入口=第一个可执行文件，页面=index.html）。 */
scripts.post('/import', async (c) => {
	const b = await c.req.json<{ dir?: string }>();
	const src = String(b.dir || '').trim().replace(/^["']|["']$/g, '');
	let st: fs.Stats;
	try {
		st = fs.statSync(src);
	} catch {
		return err(c, 400, `目录不存在: ${src}`);
	}
	if (!st.isDirectory()) return err(c, 400, `不是目录: ${src}`);
	const base = path.basename(src);
	let id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
		|| `script-${Date.now().toString(36)}`;
	while (fs.existsSync(scriptDir(id))) id = `${id}-${Date.now().toString(36).slice(-4)}`;
	const dest = scriptDir(id);
	try {
		fs.cpSync(src, dest, { recursive: true });
	} catch (e) {
		fs.rmSync(dest, { recursive: true, force: true });
		return err(c, 500, `复制目录失败: ${(e as Error).message}`);
	}

	let manifest: ScriptManifest | null = null;
	const mfPath = path.join(dest, 'script.json');
	if (fs.existsSync(mfPath)) {
		try {
			const m = JSON.parse(fs.readFileSync(mfPath, 'utf8')) as ScriptManifest;
			manifest = { ...m, id };
			fs.writeFileSync(mfPath, JSON.stringify(manifest, null, '\t'), 'utf8');
		} catch {
			manifest = null; // 损坏清单按无清单处理，重建
		}
	}
	if (!manifest) {
		const files = listFiles(dest);
		const entryFile = files.find((p) => /\.(js|mjs|py)$/i.test(p));
		const ui = files.includes('index.html') ? 'index.html' : files.find((p) => /\.html?$/i.test(p)) || null;
		manifest = {
			id,
			name: base,
			desc: `从 ${src} 导入`,
			ui,
			proxyTarget: null,
			entry: entryFile ? { file: entryFile } : null,
			args: {},
			order: 99,
		};
		fs.writeFileSync(mfPath, JSON.stringify(manifest, null, '\t'), 'utf8');
	}
	return c.json({ ok: true, id, card: toCard(id, manifest) });
});

/** POST /api/scripts — body: { name, desc?, files: [{path, content}], startArgs?, statusArgs?, stopArgs?, detached? }
 *  id 自动生成；入口文件自动取第一个可执行文件（.js/.mjs/.py）；页面入口约定 index.html（否则第一个 .html）。 */
scripts.post('/', async (c) => {
	const b = await c.req.json<{
		name: string; desc?: string;
		files?: { path: string; content: string }[];
		startArgs?: string; statusArgs?: string; stopArgs?: string; detached?: boolean;
	}>();
	if (!String(b.name || '').trim()) return err(c, 400, '显示名不能为空');
	const files = Array.isArray(b.files) ? b.files.filter((f) => String(f.path || '').trim()) : [];
	if (!files.length) return err(c, 400, '至少提供一个文件');
	const seen = new Set<string>();
	for (const f of files) {
		const rel = String(f.path).trim();
		if (rel.split(/[\\/]/).some((seg) => !seg || seg === '.' || seg === '..' || seg.startsWith('.'))) {
			return err(c, 400, `非法文件名: ${rel}`);
		}
		if (seen.has(rel)) return err(c, 400, `文件名重复: ${rel}`);
		seen.add(rel);
	}
	const id = `script-${Date.now().toString(36)}`;
	const entryFile = files.map((f) => String(f.path).trim()).find((p) => /\.(js|mjs|py)$/i.test(p));
	const entry: ScriptEntrySpec | null = entryFile ? { file: entryFile } : null;
	const lower = files.map((f) => String(f.path).trim());
	const ui = lower.includes('index.html') ? 'index.html' : lower.find((p) => /\.html?$/i.test(p)) || null;
	const args: ScriptArgs = {
		start: String(b.startArgs || '').trim() || undefined,
		status: String(b.statusArgs || '').trim() || undefined,
		stop: String(b.stopArgs || '').trim() || undefined,
	};

	const dir = scriptDir(id);
	if (fs.existsSync(dir)) return err(c, 409, `目录冲突，请重试`);
	try {
		fs.mkdirSync(dir, { recursive: true });
		const manifest: ScriptManifest = {
			id,
			name: String(b.name).trim(),
			desc: String(b.desc || '').trim(),
			ui,
			proxyTarget: null,
			entry,
			args,
			detached: !!b.detached,
			order: 99,
		};
		fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(manifest, null, '\t'), 'utf8');
		for (const f of files) {
			fs.writeFileSync(safeJoin(dir, String(f.path).trim()), String(f.content ?? ''), 'utf8');
		}
	} catch (e) {
		fs.rmSync(dir, { recursive: true, force: true }); // 半成品不留在卡片列表里
		return err(c, 500, (e as Error).message);
	}
	return c.json({ ok: true, id });
});

function loadOr404(c: any): { id: string; manifest: ScriptManifest } | Response {
	const id = c.req.param('id');
	if (!SCRIPT_ID_RE.test(id)) return err(c, 400, '非法脚本ID');
	if (!fs.existsSync(scriptDir(id))) return err(c, 404, `脚本 ${id} 不存在`);
	let manifest: ScriptManifest;
	try {
		manifest = readManifest(id);
	} catch (e) {
		return err(c, 500, `script.json 读取失败: ${(e as Error).message}`);
	}
	return { id, manifest };
}

/** GET /api/scripts/:id — 单卡详情（含文件列表），控制台当前未用，供调试。 */
scripts.get('/:id', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id, manifest } = loaded;
	return c.json({ ...toCard(id, manifest), dir: scriptDir(id), files: listFiles(scriptDir(id)) });
});

/** DELETE /api/scripts/:id — 删除整个脚本目录（运行中拒绝；控制台未出按钮，供目录管理兜底）。 */
scripts.delete('/:id', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id } = loaded;
	if (statusOf(id).status === 'running') {
		return err(c, 409, '脚本正在运行，请先关闭');
	}
	fs.rmSync(scriptDir(id), { recursive: true, force: true });
	return c.json({ ok: true });
});

/* ===================== 启动 / 查看状态 / 关闭（控制台三键对应的后端） ===================== */

/** POST /api/scripts/:id/start — 以「启动参数」拉起；清单 detached:true 时常驻（脱离宿主生命周期）。 */
scripts.post('/:id/start', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id, manifest } = loaded;
	if (!manifest.entry) return err(c, 400, '纯页面脚本，无可执行入口');
	const args = String(manifest.args?.start || '').trim();
	try {
		return c.json({ ok: true, status: startProc(id, scriptDir(id), manifest.entry, args, { detached: !!manifest.detached }) });
	} catch (e) {
		return err(c, 409, (e as Error).message);
	}
});

/** POST /api/scripts/:id/status-run — 以「查看状态参数」跑短命令，捕获输出返回（≤30s 超时强杀）。 */
scripts.post('/:id/status-run', async (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id, manifest } = loaded;
	if (!manifest.entry) return err(c, 400, '纯页面脚本，无可执行入口');
	const args = String(manifest.args?.status || '').trim();
	if (!args) return err(c, 400, '该脚本未配置查看状态参数');
	const cmd = `${runtimeCmd(manifest.entry.file)} ${manifest.entry.file} ${args}`;
	const r = await runShort(id, scriptDir(id), cmd, 30000);
	return c.json({ ok: true, code: r.code, timedOut: r.timedOut, output: r.output });
});

/** POST /api/scripts/:id/stop — 先兜底强杀托管进程；配了「关闭参数」再跑短命令让脚本善后。 */
scripts.post('/:id/stop', async (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id, manifest } = loaded;
	const killed = stopProc(id); // 没有运行实例时返回 false，不算错误
	let cleanup: { code: number | null; output: string; timedOut: boolean } | null = null;
	const stopArgs = String(manifest.args?.stop || '').trim();
	if (manifest.entry && stopArgs) {
		const cmd = `${runtimeCmd(manifest.entry.file)} ${manifest.entry.file} ${stopArgs}`;
		cleanup = await runShort(id, scriptDir(id), cmd, 15000);
	}
	return c.json({ ok: true, killed, cleanup });
});

/** GET /api/scripts/:id/status */
scripts.get('/:id/status', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	return c.json(statusOf(loaded.id));
});

/** GET /api/scripts/:id/log?since=<全局行号> — 调试用增量输出，控制台 UI 不展示。 */
scripts.get('/:id/log', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const since = Number(c.req.query('since') || 0) || 0;
	return c.json(logOf(loaded.id, since));
});

/* ===================== 文件读取（调试/兜底用，控制台不做在线编辑） ===================== */

scripts.get('/:id/files', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	return c.json(listFiles(scriptDir(loaded.id)));
});

scripts.get('/:id/file', (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const rel = c.req.query('path') || '';
	const abs = safeJoin(scriptDir(loaded.id), rel);
	if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return err(c, 404, '文件不存在');
	return c.json({ path: rel, content: fs.readFileSync(abs, 'utf8') });
});

/* ===================== 页面网关代理 ===================== */
// /api/scripts/:id/proxy/* → manifest.proxyTarget/*。
// 脚本自带页面里的绝对 /api/* 调用改走本前缀（页面按自身路径推导前缀，无需硬编码 id）。
const PROXY_STRIP = (id: string) => `/api/scripts/${id}/proxy/`;

scripts.all('/:id/proxy/*', async (c) => {
	const loaded = loadOr404(c);
	if (loaded instanceof Response) return loaded;
	const { id, manifest } = loaded;
	if (!manifest.proxyTarget) return err(c, 404, '该脚本未配置 proxyTarget');
	const url = new URL(c.req.raw.url);
	const rest = url.pathname.slice(PROXY_STRIP(id).length);
	const target = manifest.proxyTarget.replace(/\/+$/, '') + '/' + rest + url.search;
	const headers = new Headers(c.req.raw.headers);
	headers.delete('host');
	headers.delete('content-length');
	const method = c.req.raw.method;
	const hasBody = !['GET', 'HEAD'].includes(method);
	const init = {
		method,
		headers,
		body: hasBody ? c.req.raw.body : undefined,
		// Node 的 undici 流式 body 需要显式 duplex；类型里没有该字段
		...(hasBody ? { duplex: 'half' } : {}),
	} as RequestInit;
	try {
		return await proxy(new Request(target, init));
	} catch (e) {
		return err(c, 502, `proxy error: ${(e as Error).message}`);
	}
});

/* ===================== 脚本页面静态伺服（/scripts-pages/<id>/<file>） ===================== */

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/plain; charset=utf-8',
	'.csv': 'text/csv; charset=utf-8',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
	'.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export const scriptsPages = new Hono();

function servePageFile(c: any): Response {
	const id = c.req.param('id');
	if (!SCRIPT_ID_RE.test(id) || !fs.existsSync(scriptDir(id))) return c.text('not found', 404);
	// 从原始路径截取通配段（Hono 的 param('0') 拿不到 * 捕获，取到的一直是空）
	const raw = new URL(c.req.raw.url).pathname.slice(`/scripts-pages/${id}/`.length);
	let rel = decodeURIComponent(raw).replace(/^\/+/, '');
	if (!rel) {
		const ui = readManifest(id).ui; // 目录根 → 清单里的页面入口
		if (!ui) return c.text('not found', 404);
		rel = ui;
	}
	try {
		const abs = safeJoin(scriptDir(id), rel);
		if (path.basename(abs).startsWith('.') || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
			return c.text('not found', 404);
		}
		const buf = fs.readFileSync(abs);
		return c.body(buf, 200, {
			'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
			'Content-Length': String(buf.length),
			'Cache-Control': 'no-cache',
		});
	} catch {
		return c.text('not found', 404);
	}
}

scriptsPages.get('/:id/*', servePageFile);
scriptsPages.get('/:id', servePageFile);
