// Scripts store — 一脚本一目录（scripts/<id>/ + script.json），目录即卡片。
// 单入口：manifest.entry 声明唯一可执行文件+默认参数（无 entry = 纯页面脚本）。
// 存储根：CCC_SCRIPTS_DIR 环境变量覆盖，默认 <dataRoot>/scripts 即 ~/.ai-tools/scripts
// （exe 打包后仍落在用户目录）。

import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from '../data-dir.js';

/** 唯一执行入口：文件按扩展名路由运行时（.py → python，.js/.mjs → node），新建时自动取第一个可执行文件。 */
export interface ScriptEntrySpec {
	file: string;
}

/** 三个控制动作各自的参数（传给同一入口文件）。 */
export interface ScriptArgs {
	/** 启动参数：长驻进程。 */
	start?: string;
	/** 查看状态参数：短命令，输出弹窗展示。 */
	status?: string;
	/** 关闭参数：短命令（脚本自行善后），控制台仍会兜底强杀托管进程。 */
	stop?: string;
}

export interface ScriptManifest {
	id: string;
	name: string;
	desc?: string;
	/** 页面入口（相对路径），有值则卡片可打开页面（/scripts-pages/<id>/<ui>）。 */
	ui?: string | null;
	/** 页面网关代理目标：/api/scripts/<id>/proxy/* → <proxyTarget>/*（页面里的绝对 /api 调用靠它透传）。 */
	proxyTarget?: string | null;
	/** 唯一执行入口；缺省/null = 纯页面脚本。 */
	entry?: ScriptEntrySpec | null;
	/** 三键参数（启动/状态/关闭各自传给入口文件的参数）。 */
	args?: ScriptArgs;
	/** 服务型工具：true = detached 常驻拉起（宿主重启后仍运行，控制台凭 pid 探活显示状态）。 */
	detached?: boolean;
	order?: number;
}

export function scriptsRoot(): string {
	return process.env.CCC_SCRIPTS_DIR || path.join(dataRoot(), 'scripts');
}

export function scriptDir(id: string): string {
	return path.join(scriptsRoot(), id);
}

/** Windows 上 path.resolve(dir, '/x') 会落到盘符根，统一先剥前导斜杠再 resolve，并兜底防穿越。 */
export function safeJoin(dir: string, rel: string): string {
	const clean = String(rel || '').replace(/^[/\\]+/, '');
	const p = path.resolve(dir, clean);
	if (p !== path.resolve(dir) && !p.startsWith(path.resolve(dir) + path.sep)) throw new Error('非法路径');
	return p;
}

export function readManifest(id: string): ScriptManifest {
	return JSON.parse(fs.readFileSync(path.join(scriptDir(id), 'script.json'), 'utf8'));
}

export function listScriptIds(): string[] {
	const root = scriptsRoot();
	if (!fs.existsSync(root)) return [];
	return fs.readdirSync(root)
		.filter((n) => {
			const d = path.join(root, n);
			return !n.startsWith('.') && fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'script.json'));
		})
		.sort();
}

/** 递归列出目录下全部文件（相对路径，跳过点文件），排序返回。 */
export function listFiles(dir: string, base = '', out: string[] = []): string[] {
	for (const name of fs.readdirSync(dir)) {
		if (name.startsWith('.')) continue;
		const full = path.join(dir, name);
		const rel = base ? `${base}/${name}` : name;
		if (fs.statSync(full).isDirectory()) listFiles(full, rel, out);
		else out.push(rel);
	}
	return out.sort();
}

/** 按入口文件扩展名路由运行时命令。 */
export function runtimeCmd(file: string): string {
	return /\.py$/i.test(file) ? 'python' : 'node';
}

export const SCRIPT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
