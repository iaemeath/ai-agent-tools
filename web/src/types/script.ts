// Script (卡片) domain types — 薄壳启动器模型：
// 控制台是进程唯一权威（启动/查看状态/关闭三键，各用各的参数），页面归脚本自己；单入口自动识别。
// 服务型工具（detached）常驻拉起，宿主重启后控制台凭 pid 探活继续显示状态。

export type ScriptEntryStatus = 'idle' | 'running' | 'exited';

export interface ScriptProcState {
	status: ScriptEntryStatus;
	pid: number | null;
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	argstr: string;
	detached: boolean;
}

export interface ScriptEntrySpec {
	file: string;
}

/** 三个控制动作各自的参数。 */
export interface ScriptArgsSpec {
	start?: string;
	status?: string;
	stop?: string;
}

export interface ScriptCard {
	id: string;
	name: string;
	desc?: string;
	/** 页面入口（相对路径），null = 点卡片无页面可开。 */
	ui?: string | null;
	proxyTarget?: string | null;
	order?: number;
	/** 唯一执行入口（自动识别）；null = 纯页面脚本。 */
	entry: ScriptEntrySpec | null;
	/** 三键参数（客户端据此禁用没配参数的按钮）。 */
	args: ScriptArgsSpec;
	/** 服务型工具（detached 常驻拉起）。 */
	detached: boolean;
	/** 该脚本唯一进程的实时状态。 */
	status: ScriptProcState;
}

export interface ScriptFileInput {
	path: string;
	content: string;
}

export interface ScriptCreateInput {
	name: string;
	desc?: string;
	files: ScriptFileInput[];
	/** 启动参数（传给入口文件；状态与关闭由控制台负责）。 */
	startArgs?: string;
	detached?: boolean;
}

export interface ScriptStatusRunResult {
	ok: true;
	code: number | null;
	timedOut: boolean;
	output: string;
}

export interface ScriptLogResult {
	lines: string[];
	next: number;
	running: boolean;
	pid: number | null;
	exitCode: number | null;
	source: 'ring' | 'file';
}
