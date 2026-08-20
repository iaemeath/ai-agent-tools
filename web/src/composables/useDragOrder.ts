// useDragOrder — reusable drag-to-reorder logic for card grids.
//
// Persists per-group ordering to localStorage as a PURE UI preference. The
// underlying tools (Claude Code / ZCode) never read this order; they load
// resources by their own logic. This composable holds zero page-specific data:
// it knows nothing about RuleInfo / ToolInstance / McpServer — it only deals in
// path strings (the stable identity of a reorderable item).
//
// USAGE (any view with a draggable card grid):
//   const drag = useDragOrder('rules-order');          // unique key per resource
//   const { dragPath, dragOverPath } = drag;            // expose for template
//   drag.loadOrder();                                   // on mount
//   // in computed:
//   drag.sortByOrder(items, drag.orderMap.value['global'] ?? [])
//   // page supplies current group paths at drop time (page knows its own grouping):
//   function dropAt(e, groupKey, target) {
//     drag.onDrop(e, groupKey, target, groupCurrentPaths(groupKey));
//   }
//   // card template:
//   //   draggable="true"
//   //   :class="{ dragging: dragPath === item.path, 'drag-over': dragOverPath === item.path }"
//   //   @dragstart="drag.onDragStart($event, item.path)"
//   //   @dragover="drag.onDragOver($event, item.path)"
//   //   @drop="dropAt($event, 'global', item.path)"
//   //   @dragend="drag.onDragEnd"

import { ref, type Ref } from 'vue';

const STORAGE_PREFIX = 'ai-agent-tools:';

export function useDragOrder(storageKey: string) {
	const fullKey = STORAGE_PREFIX + storageKey;
	const orderMap: Ref<Record<string, string[]>> = ref({});
	const dragPath: Ref<string | null> = ref(null);
	const dragOverPath: Ref<string | null> = ref(null);

	/** Load saved per-group orders from localStorage into orderMap. */
	function loadOrder(): void {
		try {
			orderMap.value = JSON.parse(localStorage.getItem(fullKey) ?? '{}');
		} catch {
			orderMap.value = {};
		}
	}

	function saveOrder(map: Record<string, string[]>): void {
		try {
			localStorage.setItem(fullKey, JSON.stringify(map));
		} catch { /* ignore quota errors */ }
	}

	/**
	 * Sort by saved order. Items absent from `saved` (newly added since last
	 * reorder) keep their relative order and are appended after the ordered ones.
	 * `idOf` extracts the stable identity string used to match against saved
	 * (path for rules, name for skills/mcps, encoded for projects, ...).
	 */
	function sortByOrder<T>(arr: T[], saved: string[], idOf: (x: T) => string): T[] {
		if (!saved.length) return arr;
		const idx = new Map(saved.map((p, i) => [p, i]));
		return [
			...arr.filter((x) => idx.has(idOf(x))).sort((a, b) => idx.get(idOf(a))! - idx.get(idOf(b))!),
			...arr.filter((x) => !idx.has(idOf(x))),
		];
	}

	function onDragStart(e: DragEvent, path: string): void {
		dragPath.value = path;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', path); // Firefox needs this to start dragging
		}
	}

	function onDragOver(e: DragEvent, path: string): void {
		e.preventDefault(); // allow drop
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOverPath.value = path;
	}

	/**
	 * Drop handler. `currentPaths` is the group's current path[] order, supplied
	 * by the caller (the page knows its own grouping/data — this composable does
	 * not). The dragged item is moved to the target position and the new order
	 * is persisted. currentPaths is treated as a snapshot (caller passes a fresh
	 * array from .map), so splicing here is safe.
	 */
	function onDrop(e: DragEvent, groupKey: string, targetPath: string, currentPaths: string[]): void {
		e.preventDefault();
		const src = dragPath.value;
		dragPath.value = null;
		dragOverPath.value = null;
		if (!src || src === targetPath) return;
		const fromIdx = currentPaths.indexOf(src);
		const toIdx = currentPaths.indexOf(targetPath);
		if (fromIdx < 0 || toIdx < 0) return;
		const next = [...currentPaths];
		next.splice(fromIdx, 1);
		next.splice(toIdx, 0, src);
		orderMap.value = { ...orderMap.value, [groupKey]: next };
		saveOrder(orderMap.value);
	}

	function onDragEnd(): void {
		dragPath.value = null;
		dragOverPath.value = null;
	}

	return { orderMap, dragPath, dragOverPath, loadOrder, sortByOrder, onDragStart, onDragOver, onDrop, onDragEnd };
}
