// MCP tool lister — connects to an MCP server (stdio / http / sse), runs the
// JSON-RPC 2.0 handshake (initialize → notifications/initialized → tools/list),
// and returns the tool names + descriptions the server exposes.
//
// This is a best-effort, read-only runtime probe: it never writes config, spawns
// only short-lived connections, and always cleans up (kills the process / closes
// the stream) within a bounded timeout. Failures are surfaced as thrown errors
// with a clear message; the route layer turns them into an inline UI message.

import { spawn, execFile } from 'node:child_process';
import type { McpServer } from './model.js';

export interface McpToolInfo {
	name: string;
	description?: string;
}

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'ccc-ui', version: '0.3.0' };
const DEFAULT_TIMEOUT = 12000;

/** Connect to the server per its transport and return its declared tools. */
export async function listMcpTools(server: McpServer, timeoutMs = DEFAULT_TIMEOUT): Promise<McpToolInfo[]> {
	if (server.transport === 'stdio') return listStdioTools(server, timeoutMs);
	if (server.transport === 'http') return listHttpTools(server, timeoutMs);
	if (server.transport === 'sse') return listSseTools(server, timeoutMs);
	throw new Error(`unsupported transport: ${server.transport}`);
}

/** Normalize a raw tools/list result into McpToolInfo[]. */
function normalizeTools(tools: unknown): McpToolInfo[] {
	if (!Array.isArray(tools)) return [];
	return tools
		.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
		.map((t) => ({
			name: String(t['name'] ?? ''),
			description: typeof t['description'] === 'string' ? t['description'] : undefined,
		}))
		.filter((t) => t.name);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- stdio ----------------------------------------------------------------

function listStdioTools(server: McpServer, timeoutMs: number): Promise<McpToolInfo[]> {
	return new Promise((resolve, reject) => {
		if (!server.command) {
			reject(new Error('stdio server has no command'));
			return;
		}
		// shell: true so Windows resolves .cmd wrappers (npx.cmd, etc.) uniformly.
		// The command+args come from the user's own trusted MCP config.
		const env = { ...process.env, ...(server.env ?? {}) };
		const proc = spawn(server.command, server.args ?? [], {
			env,
			stdio: ['pipe', 'pipe', 'pipe'],
			shell: true,
		});

		let buffer = '';
		let finished = false;
		let stderrText = '';
		const pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

		const finish = (err: Error | null, tools?: McpToolInfo[]) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			killTree(proc.pid);
			if (err) reject(err);
			else resolve(tools ?? []);
		};

		const timer = setTimeout(
			() => finish(new Error(`连接超时（${timeoutMs / 1000}s）— 服务器未响应 tools/list`)),
			timeoutMs,
		);
		proc.on('error', (e) => finish(e));

		const send = (msg: unknown): void => {
			try {
				proc.stdin.write(JSON.stringify(msg) + '\n');
			} catch {
				/* stdin closed — ignore */
			}
		};
		const request = (id: number, method: string, params?: unknown): Promise<unknown> =>
			new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				send({ jsonrpc: '2.0', id, method, params: params ?? {} });
			});

		proc.stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();
			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line) continue;
				let msg: { id?: number; result?: unknown; error?: { message?: string } };
				try {
					msg = JSON.parse(line);
				} catch {
					continue; // non-JSON line (banner etc.)
				}
				if (msg.id !== undefined && pending.has(msg.id)) {
					const entry = pending.get(msg.id)!;
					pending.delete(msg.id);
					if (msg.error) entry.reject(new Error(msg.error.message ?? 'rpc error'));
					else entry.resolve(msg.result);
				}
			}
		});
		proc.stderr.on('data', (c: Buffer) => {
			stderrText += c.toString();
		});
		proc.on('exit', (code) => {
			if (!finished) {
				const tail = stderrText.trim().slice(0, 200);
				finish(new Error(`进程已退出 (code ${code})${tail ? '：' + tail : ''}`));
			}
		});

		// Handshake.
		void (async () => {
			try {
				await request(1, 'initialize', {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: CLIENT_INFO,
				});
				send({ jsonrpc: '2.0', method: 'notifications/initialized' });
				const listResult = await request(2, 'tools/list', {});
				finish(null, normalizeTools((listResult as { tools?: unknown })?.tools));
			} catch (e) {
				finish(e as Error);
			}
		})();
	});
}

/** Kill a process and (on Windows) its whole child tree. */
function killTree(pid: number | undefined): void {
	if (!pid) return;
	try {
		process.kill(pid);
	} catch {
		/* already dead */
	}
	if (process.platform === 'win32') {
		// taskkill /T recurses into child processes (npx → node …).
		execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => {
			/* fire-and-forget cleanup */
		});
	}
}

// ---- http (Streamable HTTP) ----------------------------------------------

async function listHttpTools(server: McpServer, timeoutMs: number): Promise<McpToolInfo[]> {
	if (!server.url) throw new Error('http server has no url');
	const baseHeaders: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json, text/event-stream',
		...(server.headers ?? {}),
	};
	let sessionId: string | undefined;

	async function rpc(id: number, method: string, params?: unknown): Promise<unknown> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const headers = { ...baseHeaders, ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) };
			const res = await fetch(server.url!, {
				method: 'POST',
				headers,
				body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
				signal: ctrl.signal,
			});
			const sid = res.headers.get('mcp-session-id');
			if (sid) sessionId = sid;
			if (res.status === 202 || res.status === 204) return undefined; // notification ack
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const ct = res.headers.get('content-type') ?? '';
			if (ct.includes('text/event-stream')) {
				return extractSseMessage(await res.text(), id);
			}
			// JSON-RPC envelope: unwrap to .result and surface protocol errors.
			// (stdio and SSE paths already return the unwrapped result; this keeps
			// the plain-JSON HTTP response consistent with them.)
			const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
			if (json.error) throw new Error(json.error.message ?? 'rpc error');
			return json.result;
		} finally {
			clearTimeout(timer);
		}
	}

	const initResult = await rpc(1, 'initialize', {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: CLIENT_INFO,
	});
	if (!initResult) throw new Error('initialize 返回为空');
	// notifications/initialized — best-effort (some servers 202/204, others reject).
	await rpc(0, 'notifications/initialized').catch(() => undefined);
	const listResult = await rpc(2, 'tools/list', {});
	return normalizeTools((listResult as { tools?: unknown })?.tools);
}

/** Parse one SSE block (text between blank-line separators) into its event name + data. */
function parseSseBlock(block: string): { event?: string; data?: string } {
	const lines = block.split('\n');
	const eventLine = lines.find((l) => l.startsWith('event:'));
	const event = eventLine ? eventLine.replace(/^event:\s?/, '').trim() : undefined;
	const data = lines
		.filter((l) => l.startsWith('data:'))
		.map((l) => l.replace(/^data:\s?/, ''))
		.join('\n');
	return { event, data: data || undefined };
}

/** Parse an SSE response body and return the JSON-RPC message matching `id`. */
function extractSseMessage(text: string, id: number): unknown {
	for (const block of text.split(/\n\n/)) {
		const { data } = parseSseBlock(block);
		if (!data) continue;
		// Only JSON *parse* failures are skippable (comment/heartbeat events);
		// a matching RPC-level error must propagate.
		let msg: { id?: number; result?: unknown; error?: { message?: string } };
		try {
			msg = JSON.parse(data);
		} catch {
			continue;
		}
		if (msg.id === id) {
			if (msg.error) throw new Error(msg.error.message ?? 'rpc error');
			return msg.result;
		}
	}
	return undefined;
}

// ---- sse (legacy SSE transport) ------------------------------------------
// Legacy flow: GET the SSE URL → server streams an `endpoint` event whose data is
// a POST path; client POSTs JSON-RPC to that endpoint and reads responses on the
// still-open GET stream.

async function listSseTools(server: McpServer, timeoutMs: number): Promise<McpToolInfo[]> {
	if (!server.url) throw new Error('sse server has no url');
	const res = await fetch(server.url, {
		headers: { Accept: 'text/event-stream', ...(server.headers ?? {}) },
	});
	if (!res.ok || !res.body) throw new Error(`SSE 连接失败 (HTTP ${res.status})`);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let endpointUrl: string | undefined;
	const pending = new Map<number, (msg: { result?: unknown; error?: { message?: string } }) => void>();
	let closed = false;

	const overallTimer = setTimeout(() => {
		closed = true;
		reader.cancel().catch(() => undefined);
	}, timeoutMs);

	const readLoop = (async () => {
		while (!closed) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf('\n\n')) >= 0) {
				const block = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const { event: eventName, data } = parseSseBlock(block);
				if (eventName === 'endpoint' && data) {
					endpointUrl = resolveUrl(server.url!, data);
					continue;
				}
				if (data) {
					try {
						const msg = JSON.parse(data) as { id?: number; result?: unknown; error?: { message?: string } };
						if (msg.id !== undefined && pending.has(msg.id)) {
							pending.get(msg.id)!(msg);
							pending.delete(msg.id);
						}
					} catch {
						/* skip */
					}
				}
			}
		}
	})();

	function resolveUrl(base: string, relative: string): string {
		try {
			return new URL(relative, base).href;
		} catch {
			return relative;
		}
	}

	async function rpc(id: number, method: string, params?: unknown): Promise<unknown> {
		// Wait for the endpoint event.
		const start = Date.now();
		while (!endpointUrl && Date.now() - start < timeoutMs) await sleep(40);
		if (!endpointUrl) throw new Error('SSE 未收到 endpoint 事件');
		return new Promise((resolve, reject) => {
			pending.set(id, (msg) => {
				if (msg.error) reject(new Error(msg.error.message ?? 'rpc error'));
				else resolve(msg.result);
			});
			fetch(endpointUrl!, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(server.headers ?? {}) },
				body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
			}).catch((e) => {
				pending.delete(id);
				reject(e);
			});
		});
	}

	async function notify(method: string): Promise<void> {
		if (!endpointUrl) return;
		await fetch(endpointUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(server.headers ?? {}) },
			body: JSON.stringify({ jsonrpc: '2.0', method }),
		}).catch(() => undefined);
	}

	try {
		await rpc(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
		await notify('notifications/initialized');
		const result = await rpc(2, 'tools/list', {});
		return normalizeTools((result as { tools?: unknown })?.tools);
	} finally {
		clearTimeout(overallTimer);
		closed = true;
		reader.cancel().catch(() => undefined);
		// readLoop resolves on cancel; no need to await.
		void readLoop;
	}
}
