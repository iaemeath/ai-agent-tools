import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

describe('MCP Library Store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('load', () => {
		it('should load MCPs without duplicates', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			expect(mcpLibrary.mcps).toHaveLength(2);
			expect(mcpLibrary.mcps[0].name).toBe('mcp-1');
		});

		it('should not create duplicates on multiple loads', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValue(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');

			await mcpLibrary.load();
			await mcpLibrary.load();
			await mcpLibrary.load();

			expect(mcpLibrary.mcps).toHaveLength(2);
		});

		it('should handle empty response', async () => {
			vi.mocked(invoke).mockResolvedValueOnce([]);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			expect(mcpLibrary.mcps).toHaveLength(0);
		});

		it('should set isLoading during load', async () => {
			const mockMcps = [{ id: 1, name: 'mcp-1', type: 'stdio' }] as any[];

			let resolveInvoke: (value: unknown) => void;
			const invokePromise = new Promise((resolve) => {
				resolveInvoke = resolve;
			});
			vi.mocked(invoke).mockReturnValueOnce(invokePromise as Promise<unknown>);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			const loadPromise = mcpLibrary.load();

			expect(mcpLibrary.isLoading).toBe(true);

			resolveInvoke!(mockMcps);
			await loadPromise;

			expect(mcpLibrary.isLoading).toBe(false);
		});

		it('should handle errors', async () => {
			vi.mocked(invoke).mockRejectedValueOnce(new Error('Network error'));

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			expect(mcpLibrary.error).toContain('Network error');
			expect(mcpLibrary.isLoading).toBe(false);
		});
	});

	describe('create', () => {
		it('should create new MCP', async () => {
			const mockMcps = [{ id: 1, name: 'mcp-1', type: 'stdio' }] as any[];
			const newMcp = { id: 2, name: 'new-mcp', type: 'http' };

			vi.mocked(invoke)
				.mockResolvedValueOnce(mockMcps)
				.mockResolvedValueOnce(newMcp);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			const result = await mcpLibrary.create({ name: 'new-mcp', type: 'http' } as any);

			expect(result.id).toBe(2);
			expect(mcpLibrary.mcps).toHaveLength(2);
		});
	});

	describe('update', () => {
		it('should update existing MCP', async () => {
			const mockMcps = [{ id: 1, name: 'old-name', type: 'stdio' }] as any[];
			const updatedMcp = { id: 1, name: 'new-name', type: 'stdio' };

			vi.mocked(invoke)
				.mockResolvedValueOnce(mockMcps)
				.mockResolvedValueOnce(updatedMcp);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			await mcpLibrary.update(1, { name: 'new-name', type: 'stdio' } as any);

			expect(mcpLibrary.mcps[0].name).toBe('new-name');
		});
	});

	describe('delete', () => {
		it('should delete MCP', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke)
				.mockResolvedValueOnce(mockMcps)
				.mockResolvedValueOnce(undefined);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			await mcpLibrary.delete(1);

			expect(mcpLibrary.mcps).toHaveLength(1);
			expect(mcpLibrary.mcps[0].id).toBe(2);
		});
	});

	describe('duplicate', () => {
		it('should duplicate MCP', async () => {
			const mockMcps = [{ id: 1, name: 'mcp-1', type: 'stdio' }] as any[];
			const duplicatedMcp = { id: 2, name: 'mcp-1 (copy)', type: 'stdio' };

			vi.mocked(invoke)
				.mockResolvedValueOnce(mockMcps)
				.mockResolvedValueOnce(duplicatedMcp);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			const result = await mcpLibrary.duplicate(1);

			expect(result.id).toBe(2);
			expect(mcpLibrary.mcps).toHaveLength(2);
		});
	});

	describe('toggleGlobal', () => {
		it('should toggle global MCP enabled state', async () => {
			const mockMcps = [{ id: 1, name: 'mcp-1', type: 'stdio', isEnabledGlobal: false }] as any[];

			vi.mocked(invoke)
				.mockResolvedValueOnce(mockMcps)
				.mockResolvedValueOnce(undefined);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			await mcpLibrary.toggleGlobal(1, true);

			expect(mcpLibrary.mcps[0].isEnabledGlobal).toBe(true);
		});
	});

	describe('getMcpById', () => {
		it('should return correct MCP by ID', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			const mcp = mcpLibrary.getMcpById(2);

			expect(mcp?.name).toBe('mcp-2');
		});

		it('should return undefined for non-existent ID', async () => {
			vi.mocked(invoke).mockResolvedValueOnce([]);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			const mcp = mcpLibrary.getMcpById(999);

			expect(mcp).toBeUndefined();
		});
	});

	describe('setSearch', () => {
		it('should filter MCPs by name', async () => {
			const mockMcps = [
				{ id: 1, name: 'test-mcp-1', type: 'stdio' },
				{ id: 2, name: 'test-mcp-2', type: 'http' },
				{ id: 3, name: 'other-mcp', type: 'sse' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setSearch('test');

			expect(mcpLibrary.filteredMcps).toHaveLength(2);
		});

		it('should filter MCPs by description', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', description: 'Test MCP', type: 'stdio' },
				{ id: 2, name: 'mcp-2', description: 'Other', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setSearch('Test');

			expect(mcpLibrary.filteredMcps).toHaveLength(1);
		});

		it('should return all MCPs when search is empty', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setSearch('');

			expect(mcpLibrary.filteredMcps).toHaveLength(2);
		});
	});

	describe('setTypeFilter', () => {
		it('should filter MCPs by stdio type', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' },
				{ id: 3, name: 'mcp-3', type: 'sse' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setTypeFilter('stdio');

			expect(mcpLibrary.filteredMcps).toHaveLength(1);
			expect(mcpLibrary.filteredMcps[0].type).toBe('stdio');
		});

		it('should filter MCPs by http type', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setTypeFilter('http');

			expect(mcpLibrary.filteredMcps).toHaveLength(1);
		});

		it('should return all MCPs when filter is all', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'http' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			mcpLibrary.setTypeFilter('all');

			expect(mcpLibrary.filteredMcps).toHaveLength(2);
		});
	});

	describe('mcpCount', () => {
		it('should count MCPs by type', async () => {
			const mockMcps = [
				{ id: 1, name: 'mcp-1', type: 'stdio' },
				{ id: 2, name: 'mcp-2', type: 'stdio' },
				{ id: 3, name: 'mcp-3', type: 'http' },
				{ id: 4, name: 'mcp-4', type: 'sse' }
			] as any[];

			vi.mocked(invoke).mockResolvedValueOnce(mockMcps);

			const { mcpLibrary } = await import('$lib/stores/mcpLibrary.svelte');
			await mcpLibrary.load();

			expect(mcpLibrary.mcpCount.total).toBe(4);
			expect(mcpLibrary.mcpCount.stdio).toBe(2);
			expect(mcpLibrary.mcpCount.http).toBe(1);
			expect(mcpLibrary.mcpCount.sse).toBe(1);
		});
	});
});
