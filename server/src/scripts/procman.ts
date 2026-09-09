// Scripts process manager — 控制台是进程的唯一权威管理者（single source of truth）。
// 每脚本一个子进程（键 = 脚本 id），两种拉起方式：
//   attached（默认）：stdio 管道 → 内存环形缓冲 + 落盘 logs/<时间戳>.log；宿主活着时可增量拉日志
//   detached（清单 detached:true，服务型工具常驻）：stdio 直接重定向到日志文件 + unref，宿主重启后凭
//     .run.json 里的 pid 探活继续显示运行中；日志端点读文件
// 所有进程输出都落盘 logs/（每脚本保留最近 10 份）；Windows 停止用 taskkill /F /T 连进程树。

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { scriptDir } from './store.js';

const MAX_LOG_LINES = 1000;
const KEEP_LOG_FILES = 10;

export type ProcStatus = 'idle' | 'running' | 'exited';

export interface ProcState {
	status: ProcStatus;
	pid: number | null;
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	argstr: string;
	detached: boolean;
}

interface Ring {
	lines: string[];
	/** lines[0] 的全局行号（被冲掉的行计数），支撑 since 增量拉取。 */
	base: number;
}

interface Rec {
	pid: number;
	startedAt: number;
	argstr: string;
	logFile: string;
	detached: boolean;
	/** attached 独有：宿主存活期间的内存句柄与环形缓冲。 */
	child?: ChildProcess;
	ring?: Ring;
	exitCode: number | null;
	finishedAt: number | null;
}

const procs = new Map<string, Rec>();

/* ---------- .run.json（pid 落盘，per 脚本目录；宿主重启后凭它接管 detached 常驻进程的状态显示） ---------- */

interface RunFile {
	pid: number;
	startedAt: number;
	detached: boolean;
	logFile: string;
	argstr: string;
}

function runFilePath(id: string): string {
	return path.join(scriptDir(id), '.run.json');
}
function readRunFile(id: string): RunFile | null {
	try {
		return JSON.parse(fs.readFileSync(runFilePath(id), 'utf8')) as RunFile;
	} catch {
		return null;
	}
}
function writeRunEntry(id: string, rec: Rec): void {
	fs.writeFileSync(runFilePath(id), JSON.stringify({
		pid: rec.pid, startedAt: rec.startedAt, detached: rec.detached, logFile: rec.logFile, argstr: rec.argstr,
	} satisfies RunFile), 'utf8');
}
function removeRunEntry(id: string): void {
	fs.rmSync(runFilePath(id), { force: true });
}

/* ---------- 日志落盘：logs/<时间戳>.log，保留最近 KEEP_LOG_FILES 份 ---------- */

function newLogFile(id: string): string {
	const dir = path.join(scriptDir(id), 'logs');
	fs.mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
	const file = path.join(dir, `${stamp}.log`);
	const old = fs.readdirSync(dir).filter((n) => n.endsWith('.log')).sort();
	while (old.length >= KEEP_LOG_FILES) fs.rmSync(path.join(dir, old.shift() as string), { force: true });
	return file;
}
function fileLines(logFile: string): string[] {
	try {
		return fs.readFileSync(logFile, 'utf8').split('\n');
	} catch {
		return [];
	}
}

/* ---------- 环形日志（attached） ---------- */

function makeRing(): Ring {
	return { lines: [], base: 0 };
}
function ringPush(r: Ring, text: string): void {
	const parts = text.split('\n');
	for (let i = 0; i < parts.length; i++) {
		if (i < parts.length - 1) {
			r.lines.push(parts[i]);
			while (r.lines.length > MAX_LOG_LINES) {
				r.lines.shift();
				r.base++;
			}
		} else if (parts[i]) {
			r.lines.push(parts[i]);
		}
	}
}
const dec = (b: Buffer | string) => b.toString('utf8').replace(/\uFFFD/g, '');

/* ---------- 探活 ---------- */

function alive(id: string): boolean {
	const p = procs.get(id);
	if (p) {
		if (p.detached) return probeOrphan(p.pid); // detached：内存句柄不能证明存活，实时探测
		return p.exitCode === null && p.finishedAt === null;
	}
	return false;
}

function probeOrphan(pid: number): boolean {
	if (process.platform !== 'win32') return true; // 非 Windows 无法廉价探测，宁可显示运行中
	try {
		const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
		return (out.stdout || '').toUpperCase().includes(`"${pid}"`);
	} catch {
		return false;
	}
}

export function statusOf(id: string): ProcState {
	const p = procs.get(id);
	if (p) {
		if (alive(id)) return { status: 'running', pid: p.pid, startedAt: p.startedAt, finishedAt: null, exitCode: null, argstr: p.argstr, detached: p.detached };
		return { status: 'exited', pid: p.pid, startedAt: p.startedAt, finishedAt: p.finishedAt, exitCode: p.exitCode, argstr: p.argstr, detached: p.detached };
	}
	const run = readRunFile(id);
	if (run && probeOrphan(run.pid)) {
		// 宿主重启后接管 detached 常驻进程的状态显示（不重建句柄，stop 走 run.json 兜底）
		return { status: 'running', pid: run.pid, startedAt: run.startedAt, finishedAt: null, exitCode: null, argstr: run.argstr, detached: run.detached };
	}
	if (run) removeRunEntry(id);
	return { status: 'idle', pid: null, startedAt: null, finishedAt: null, exitCode: null, argstr: '', detached: false };
}

/* ---------- 启停 ---------- */

// Windows 实测：detached + shell:true 时子进程拿不到重定向句柄（输出全丢），
// 必须绕过 shell 直接拉起解释器（与 quota-tools v2 的 process.execPath 直拉同款）。
export function startProc(
	id: string,
	dir: string,
	entry: { file: string },
	args: string,
	opts: { detached?: boolean } = {},
): ProcState {
	if (alive(id)) throw new Error('已在运行中，勿重复启动');
	if (readRunFile(id)) removeRunEntry(id); // 残留的 pid 引用，清理（不主动杀）

	const logFile = newLogFile(id);
	const rec: Rec = {
		pid: 0, startedAt: Date.now(), argstr: args, logFile, detached: !!opts.detached,
		exitCode: null, finishedAt: null,
	};
	fs.appendFileSync(logFile, `$ ${runtimeCmdStr(entry.file)} ${entry.file}${args ? ` ${args}` : ''}\n[${new Date(rec.startedAt).toLocaleString('zh-CN', { hour12: false })}] start (detached=${rec.detached})\n`);
	const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };

	if (rec.detached) {
		const fd = fs.openSync(logFile, 'a');
		const child = spawn(runtimeCmdStr(entry.file), [entry.file, ...args.split(/\s+/).filter(Boolean)], {
			cwd: dir, windowsHide: true, detached: true, stdio: ['ignore', fd, fd], env,
		});
		fs.closeSync(fd);
		child.unref();
		rec.pid = child.pid ?? 0;
		child.on('error', (e: Error) => {
			fs.appendFileSync(logFile, `[host] 进程启动失败: ${e.message}\n`);
		});
	} else {
		const child = spawn(cmdline(entry.file, args), {
			shell: true, cwd: dir, windowsHide: true, env,
		});
		rec.pid = child.pid ?? 0;
		rec.child = child;
		rec.ring = makeRing();
		const tee = (d: Buffer) => {
			ringPush(rec.ring as Ring, dec(d));
			fs.appendFileSync(logFile, dec(d));
		};
		child.stdout?.on('data', tee);
		child.stderr?.on('data', tee);
		child.on('error', (e: Error) => {
			const msg = `[host] 进程启动失败: ${e.message}\n`;
			ringPush(rec.ring as Ring, msg);
			fs.appendFileSync(logFile, msg);
			rec.finishedAt = Date.now();
			rec.exitCode = -1;
			removeRunEntry(id);
		});
		child.on('exit', (code: number | null) => {
			rec.finishedAt = Date.now();
			rec.exitCode = code;
			const msg = `\n[host] 进程退出，code=${code}\n`;
			if (rec.ring) ringPush(rec.ring, msg);
			fs.appendFileSync(logFile, msg);
			if (procs.get(id) === rec) removeRunEntry(id); // 旧实例退出不误删新实例的 pid 落盘
		});
	}

	procs.set(id, rec);
	writeRunEntry(id, rec);
	return statusOf(id);
}

/** 附着模式走 shell 命令行（参数引号语义完整）。 */
function cmdline(file: string, args: string): string {
	return `${runtimeCmdStr(file)} ${file}${args ? ` ${args}` : ''}`;
}
/** 运行时解释器（detached 直拉用；win32 上 .py 也可用 py 启动器，先用 python 保持一致）。 */
function runtimeCmdStr(file: string): string {
	return /\.py$/i.test(file) ? 'python' : 'node';
}

export function stopProc(id: string): boolean {
	let pid: number | null = null;
	const p = procs.get(id);
	if (p && alive(id)) pid = p.pid;
	if (!pid) {
		const run = readRunFile(id);
		if (run && probeOrphan(run.pid)) pid = run.pid;
	}
	if (pid === null) {
		removeRunEntry(id);
		return false;
	}
	if (process.platform === 'win32') {
		const r = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
		if (r.status !== 0 && p?.child) {
			try {
				p.child.kill();
			} catch {
				/* 已退出 */
			}
		}
	} else if (p?.child) {
		p.child.kill('SIGTERM');
	}
	if (p) {
		p.finishedAt = Date.now();
		if (p.exitCode === null) p.exitCode = p.detached ? null : 1;
	}
	removeRunEntry(id);
	return true;
}

/* ---------- 短命令（查看状态/关闭参数用）：运行到退出，捕获合并输出 ---------- */

export interface ShortResult {
	code: number | null;
	output: string;
	timedOut: boolean;
}

export function runShort(id: string, dir: string, cmd: string, timeoutMs = 30000): Promise<ShortResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, {
			shell: true,
			cwd: dir,
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
		});
		const chunks: Buffer[] = [];
		let timedOut = false;
		const collect = (d: Buffer) => chunks.push(d);
		child.stdout?.on('data', collect);
		child.stderr?.on('data', collect);
		const timer = setTimeout(() => {
			timedOut = true;
			if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid ?? 0)], { stdio: 'ignore' });
			else child.kill('SIGTERM');
		}, timeoutMs);
		child.on('error', (e: Error) => {
			clearTimeout(timer);
			resolve({ code: -1, output: dec(Buffer.concat(chunks)) + `\n[host] 启动失败: ${e.message}`, timedOut });
		});
		child.on('exit', (code: number | null) => {
			clearTimeout(timer);
			resolve({ code, output: dec(Buffer.concat(chunks)), timedOut });
		});
	});
}

/* ---------- 日志：attached 走内存环，detached/宿主重启后读日志文件 ---------- */

export interface LogPage {
	lines: string[];
	next: number;
	running: boolean;
	pid: number | null;
	exitCode: number | null;
	source: 'ring' | 'file';
}

export function logOf(id: string, since: number): LogPage {
	const p = procs.get(id);
	const running = alive(id) || (!p && (() => { const r = readRunFile(id); return !!(r && probeOrphan(r.pid)); })());
	if (p?.ring) {
		const start = Math.max(p.ring.base, since);
		return {
			lines: p.ring.lines.slice(start - p.ring.base),
			next: p.ring.base + p.ring.lines.length,
			running, pid: p.pid, exitCode: p.exitCode, source: 'ring',
		};
	}
	const runFile = readRunFile(id);
	const logFile = p?.logFile ?? runFile?.logFile;
	const pid = p?.pid ?? runFile?.pid ?? null;
	if (!logFile) return { lines: [], next: 0, running, pid, exitCode: null, source: 'file' };
	let lines = fileLines(logFile);
	if (lines.length > MAX_LOG_LINES) lines = lines.slice(-MAX_LOG_LINES);
	const start = Math.max(0, Math.min(since, lines.length));
	return { lines: lines.slice(start), next: lines.length, running, pid, exitCode: p?.exitCode ?? null, source: 'file' };
}
