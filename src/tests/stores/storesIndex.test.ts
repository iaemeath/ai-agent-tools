import { describe, it, expect } from 'vitest';

describe('stores/index.ts barrel exports', () => {
	it('should export all stores', async () => {
		const mod = await import('$lib/stores/index');
		expect(mod.commandLibrary).toBeDefined();
		expect(mod.debugStore).toBeDefined();
		expect(mod.hookLibrary).toBeDefined();
		expect(mod.mcpLibrary).toBeDefined();
		expect(mod.projectsStore).toBeDefined();
		expect(mod.skillLibrary).toBeDefined();
		expect(mod.subagentLibrary).toBeDefined();
		expect(mod.repoLibrary).toBeDefined();
		expect(mod.dragDrop).toBeDefined();
		expect(mod.notifications).toBeDefined();
		expect(mod.claudeJson).toBeDefined();
		expect(mod.whatsNew).toBeDefined();
		expect(mod.memoryLibrary).toBeDefined();
		expect(mod.claudeSettingsLibrary).toBeDefined();
		expect(mod.keybindingsLibrary).toBeDefined();
		expect(mod.onboarding).toBeDefined();
	});
});
