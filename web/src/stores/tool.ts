// Global tool-profile selector — a single source of truth for which AI tool
// (Claude Code / ZCode) the app is currently targeting. AppHeader switches it;
// every View (Skills, Plugins, …) consumes it via useTool().
//
// Implemented as a module-scope singleton ref so all callers share one state
// without pulling in Pinia. A change dispatches a 'ccc-ui:tool-change' event so
// views can reset+reload their tool-dependent data (projects, overview).

import { ref } from 'vue';
import type { ToolId } from '../types/tool';

export const TOOL_OPTIONS: { value: ToolId; label: string }[] = [
	{ value: 'claude', label: 'Claude Code' },
	{ value: 'zcode', label: 'ZCode' },
];

const tool = ref<ToolId>('claude');

export function useTool() {
	function setTool(next: ToolId) {
		if (next === tool.value) return;
		tool.value = next;
		// Notify views to reset and reload their tool-dependent data.
		window.dispatchEvent(new CustomEvent<ToolId>('ccc-ui:tool-change', { detail: next }));
	}
	return { tool, TOOL_OPTIONS, setTool };
}
