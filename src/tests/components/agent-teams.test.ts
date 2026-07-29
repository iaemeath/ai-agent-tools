import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/types', async (importOriginal) => {
	const actual = await importOriginal() as any;
	return {
		...actual,
		TEAMMATE_MODES: actual.TEAMMATE_MODES ?? [
			{ value: '', label: 'Not set' },
			{ value: 'auto', label: 'Auto' },
			{ value: 'in-process', label: 'In-process' },
			{ value: 'tmux', label: 'Tmux' }
		],
		AGENT_TEAM_PERMISSION_MODES: actual.AGENT_TEAM_PERMISSION_MODES ?? [
			{ value: '', label: 'Inherit from lead' },
			{ value: 'default', label: 'Default' },
			{ value: 'auto', label: 'Auto-accept' }
		],
		AVAILABLE_MODEL_SHORTCUTS: actual.AVAILABLE_MODEL_SHORTCUTS ?? [
			{ value: 'sonnet', label: 'Sonnet' },
			{ value: 'opus', label: 'Opus' },
			{ value: 'haiku', label: 'Haiku' }
		]
	};
});

describe('AgentTeamEditor Component', () => {
	const mockSettings = {
		scope: 'user',
		availableModels: [],
		teammateMode: 'auto',
		agentTeam: {
			enabled: true,
			members: [
				{ name: 'researcher', model: 'sonnet', description: 'Handles research tasks' },
				{ name: 'frontend-dev', model: 'opus', permissionMode: 'auto' }
			]
		}
	};

	const emptySettings = {
		scope: 'user',
		availableModels: []
	};

	it('should render Agent Teams heading', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText('Agent Teams')).toBeInTheDocument();
	});

	it('should render Team Members heading', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText('Team Members')).toBeInTheDocument();
	});

	it('should render enable toggle', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		const toggle = screen.getByRole('switch', { name: 'Enable Agent Teams' });
		expect(toggle).toBeInTheDocument();
		expect(toggle.getAttribute('aria-checked')).toBe('true');
	});

	it('should render Teammate Display Mode dropdown', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		expect(screen.getByLabelText('Teammate Display Mode')).toBeInTheDocument();
	});

	it('should display existing team members', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText('researcher')).toBeInTheDocument();
		expect(screen.getByText('frontend-dev')).toBeInTheDocument();
	});

	it('should display member model badges', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText('sonnet')).toBeInTheDocument();
		expect(screen.getByText('opus')).toBeInTheDocument();
	});

	it('should show empty state when no members', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: emptySettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText(/No team members configured/)).toBeInTheDocument();
	});

	it('should call onsave with agent team data', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		const onsave = vi.fn();
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave }
		});
		await fireEvent.click(screen.getByText('Save Agent Team Settings'));
		expect(onsave).toHaveBeenCalledOnce();
		const saved = onsave.mock.calls[0][0];
		expect(saved.agentTeam.enabled).toBe(true);
		expect(saved.agentTeam.members).toHaveLength(2);
		expect(saved.teammateMode).toBe('auto');
	});

	it('should include teammateMode in save payload', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		const onsave = vi.fn();
		render(AgentTeamEditor, {
			props: { settings: mockSettings as any, onsave }
		});
		await fireEvent.click(screen.getByText('Save Agent Team Settings'));
		expect(onsave.mock.calls[0][0].teammateMode).toBe('auto');
	});

	it('should render save button', async () => {
		const { default: AgentTeamEditor } = await import('$lib/components/agent-teams/AgentTeamEditor.svelte');
		render(AgentTeamEditor, {
			props: { settings: emptySettings as any, onsave: vi.fn() }
		});
		expect(screen.getByText('Save Agent Team Settings')).toBeInTheDocument();
	});
});

describe('Agent-teams index.ts exports', () => {
	it('should export AgentTeamEditor', async () => {
		const exports = await import('$lib/components/agent-teams');
		expect(exports.AgentTeamEditor).toBeDefined();
	});
});
