// Overview aggregator — ported from src-tauri/src/scan.rs.
// Runs every adapter; an adapter that throws is warned and skipped (never fails the whole overview).

import { registry } from './adapters/types.js';
import type { ToolOverview, ScanCtx } from './model.js';

export function overview(project: string | null): ToolOverview {
	const ctx: ScanCtx = { project };
	const items: ToolOverview['items'] = [];
	for (const adapter of registry()) {
		try {
			items.push(...adapter.scan(ctx));
		} catch (e) {
			console.warn(`[scan] adapter ${adapter.kind} failed: ${(e as Error).message}`);
		}
	}
	// Sort: kind ascending (localeCompare → "plugin" before "skill"), then name ascending.
	items.sort((a, b) => {
		const k = a.kind.localeCompare(b.kind);
		return k !== 0 ? k : a.name.localeCompare(b.name);
	});
	return { items };
}
