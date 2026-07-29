import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte/pure';

vi.mock('$lib/stores', () => ({
	projectsStore: {
		projects: [],
		sortedProjects: [],
		isLoading: false,
		loadProjects: vi.fn(),
		syncProjectConfig: vi.fn(),
		getProjectById: vi.fn(),
		toggleFavorite: vi.fn(),
		assignMcpToProject: vi.fn(),
		removeMcpFromProject: vi.fn(),
		toggleProjectMcp: vi.fn(),
		globalMcps: [],
		syncGlobalConfig: vi.fn(),
		loadGlobalMcps: vi.fn(),
		addGlobalMcp: vi.fn(),
		removeGlobalMcp: vi.fn(),
		toggleGlobalMcp: vi.fn()
	},
	mcpLibrary: {
		mcps: [],
		getMcpById: vi.fn()
	},
	skillLibrary: {
		skills: [],
		getProjectSkills: vi.fn().mockResolvedValue([]),
		getSkillById: vi.fn(),
		assignToProject: vi.fn(),
		removeFromProject: vi.fn(),
		toggleProjectSkill: vi.fn(),
		globalSkills: [],
		loadGlobalSkills: vi.fn()
	},
	subagentLibrary: {
		subagents: [],
		getProjectSubAgents: vi.fn().mockResolvedValue([]),
		getSubAgentById: vi.fn(),
		assignToProject: vi.fn(),
		removeFromProject: vi.fn(),
		toggleProjectSubAgent: vi.fn(),
		globalSubAgents: [],
		loadGlobalSubAgents: vi.fn()
	},
	commandLibrary: {
		commands: [],
		getProjectCommands: vi.fn().mockResolvedValue([]),
		getCommandById: vi.fn(),
		assignToProject: vi.fn(),
		removeFromProject: vi.fn(),
		toggleProjectCommand: vi.fn(),
		globalCommands: [],
		loadGlobalCommands: vi.fn()
	},
	hookLibrary: {
		hooks: [],
		getProjectHooks: vi.fn().mockResolvedValue([]),
		getHookById: vi.fn(),
		assignToProject: vi.fn(),
		removeFromProject: vi.fn(),
		toggleProjectHook: vi.fn()
	},
	notifications: {
		success: vi.fn(),
		error: vi.fn()
	},
	claudeSettingsLibrary: {
		isLoading: false,
		error: null,
		selectedScope: 'project',
		currentScopeSettings: null,
		load: vi.fn(),
		save: vi.fn(),
		setScope: vi.fn()
	}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$app/stores', () => ({
	page: { subscribe: vi.fn((cb: any) => { cb({ url: new URL('http://localhost/projects/1?tab=tools') }); return () => {}; }) }
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
	open: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn()
}));

vi.mock('$lib/components/settings', () => ({
	SETTINGS_CATEGORIES: []
}));

vi.mock('$lib/components/claude-settings', () => ({
	ModelConfigEditor: {},
	AttributionEditor: {}
}));

vi.mock('$lib/components/sandbox', () => ({
	SandboxConfigEditor: {}
}));

vi.mock('$lib/components/plugins', () => ({
	PluginListEditor: {},
	MarketplaceEditor: {}
}));

vi.mock('$lib/components/env-vars', () => ({
	EnvVarsEditor: {}
}));

vi.mock('$lib/components/ui-toggles', () => ({
	UITogglesEditor: {}
}));

vi.mock('$lib/components/file-suggestion', () => ({
	FileSuggestionEditor: {}
}));

vi.mock('$lib/components/session-cleanup', () => ({
	SessionCleanupEditor: {}
}));

vi.mock('$lib/components/auth-helpers', () => ({
	AuthHelpersEditor: {}
}));

vi.mock('$lib/components/mcp-approval', () => ({
	McpApprovalEditor: {}
}));

describe('ProjectCard Component', () => {
	let ProjectCard: any;

	const mockProject = {
		id: 1,
		name: 'Test Project',
		path: '/home/user/project',
		editorType: 'claude_code' as const,
		assignedMcps: [
			{ id: 1, mcpId: 1, isEnabled: true, mcp: { id: 1, name: 'MCP1', type: 'stdio' as const } }
		],
		hasMcpFile: false,
		hasSettingsFile: false,
		isFavorite: false,
		createdAt: '2024-01-01',
		updatedAt: '2024-01-01'
	};

	beforeAll(async () => {
		const mod = await import('$lib/components/projects/ProjectCard.svelte');
		ProjectCard = mod.default;
	});

	it('should render project name', () => {
		render(ProjectCard, { props: { project: mockProject } });
		expect(screen.getByText('Test Project')).toBeInTheDocument();
	});

	it('should render project path', () => {
		render(ProjectCard, { props: { project: mockProject } });
		expect(screen.getByText('/home/user/project')).toBeInTheDocument();
	});

	it('should show Claude badge for claude_code editor type', () => {
		render(ProjectCard, { props: { project: mockProject } });
		expect(screen.getByText('Claude')).toBeInTheDocument();
	});

	it('should show OpenCode badge for opencode editor type', () => {
		render(ProjectCard, {
			props: { project: { ...mockProject, editorType: 'opencode' } }
		});
		expect(screen.getByText('OpenCode')).toBeInTheDocument();
	});

	it('should show .mcp.json badge when hasMcpFile is true', () => {
		render(ProjectCard, {
			props: { project: { ...mockProject, hasMcpFile: true } }
		});
		expect(screen.getByText('.mcp.json')).toBeInTheDocument();
	});

	it('should not show .mcp.json badge when hasMcpFile is false', () => {
		render(ProjectCard, {
			props: { project: { ...mockProject, hasMcpFile: false } }
		});
		expect(screen.queryByText('.mcp.json')).not.toBeInTheDocument();
	});

	it('should show MCP count when there are MCPs', () => {
		render(ProjectCard, { props: { project: mockProject } });
		expect(screen.getByText('1/1')).toBeInTheDocument();
	});

	it('should show 0 for MCP count when no MCPs', () => {
		render(ProjectCard, {
			props: { project: { ...mockProject, assignedMcps: [] } }
		});
		expect(screen.getAllByText('0').length).toBeGreaterThan(0);
	});

	it('should show skills count as 0 when no preloaded skills', () => {
		render(ProjectCard, { props: { project: mockProject } });
		// Skills, agents both show 0 initially
		const zeros = screen.getAllByText('0');
		expect(zeros.length).toBeGreaterThanOrEqual(2);
	});

	it('should show skills count when preloadedSkills provided', () => {
		const skills = [
			{ id: 1, skillId: 1, isEnabled: true, skill: { id: 1, name: 'Skill1' } },
			{ id: 2, skillId: 2, isEnabled: false, skill: { id: 2, name: 'Skill2' } }
		];
		render(ProjectCard, {
			props: { project: mockProject, preloadedSkills: skills }
		});
		expect(screen.getByText('1/2')).toBeInTheDocument();
	});

	it('should show agents count when preloadedAgents provided', () => {
		const agents = [
			{ id: 1, subagentId: 1, isEnabled: true, subagent: { id: 1, name: 'Agent1' } }
		];
		render(ProjectCard, {
			props: { project: mockProject, preloadedAgents: agents }
		});
		// enabled/total = 1/1 - but this conflicts with MCP count, so just check aria label
		const el = screen.getByLabelText('1 of 1 agents enabled');
		expect(el).toBeInTheDocument();
	});

	it('should render FavoriteButton when onFavoriteToggle provided', () => {
		render(ProjectCard, {
			props: { project: mockProject, onFavoriteToggle: vi.fn() }
		});
		// FavoriteButton renders a button with accessible name
		const favBtn = screen.getByLabelText(`Add ${mockProject.name} to favorites`);
		expect(favBtn).toBeInTheDocument();
	});

	it('should not render FavoriteButton when onFavoriteToggle not provided', () => {
		render(ProjectCard, {
			props: { project: mockProject }
		});
		expect(screen.queryByLabelText(`Add ${mockProject.name} to favorites`)).not.toBeInTheDocument();
	});

	it('should call onClick when card is clicked', async () => {
		const onClick = vi.fn();
		render(ProjectCard, {
			props: { project: mockProject, onClick }
		});
		// The card is a div with role="button" and tabindex="0"
		const cards = screen.getAllByRole('button');
		const card = cards.find(el => el.getAttribute('tabindex') === '0');
		expect(card).toBeTruthy();
		await fireEvent.click(card!);
		expect(onClick).toHaveBeenCalled();
	});

	it('should call onClick on Enter key press', async () => {
		const onClick = vi.fn();
		render(ProjectCard, {
			props: { project: mockProject, onClick }
		});
		const cards = screen.getAllByRole('button');
		const card = cards.find(el => el.getAttribute('tabindex') === '0');
		expect(card).toBeTruthy();
		await fireEvent.keyDown(card!, { key: 'Enter' });
		expect(onClick).toHaveBeenCalled();
	});

	it('should call onClick on Space key press', async () => {
		const onClick = vi.fn();
		render(ProjectCard, {
			props: { project: mockProject, onClick }
		});
		const cards = screen.getAllByRole('button');
		const card = cards.find(el => el.getAttribute('tabindex') === '0');
		expect(card).toBeTruthy();
		await fireEvent.keyDown(card!, { key: ' ' });
		expect(onClick).toHaveBeenCalled();
	});

	it('should show enabled/total counts with mixed enabled MCPs', () => {
		const project = {
			...mockProject,
			assignedMcps: [
				{ id: 1, mcpId: 1, isEnabled: true, mcp: { id: 1, name: 'MCP1', type: 'stdio' as const } },
				{ id: 2, mcpId: 2, isEnabled: false, mcp: { id: 2, name: 'MCP2', type: 'sse' as const } },
				{ id: 3, mcpId: 3, isEnabled: true, mcp: { id: 3, name: 'MCP3', type: 'http' as const } }
			]
		};
		render(ProjectCard, { props: { project } });
		expect(screen.getByLabelText('2 of 3 MCPs enabled')).toBeInTheDocument();
	});
});

describe('ProjectList Component', () => {
	let ProjectList: any;

	beforeAll(async () => {
		const mod = await import('$lib/components/projects/ProjectList.svelte');
		ProjectList = mod.default;
	});

	it('should show empty state when no projects', () => {
		render(ProjectList, { props: {} });
		expect(screen.getByText('No projects added')).toBeInTheDocument();
	});

	it('should show Add Project button when callback provided', () => {
		render(ProjectList, {
			props: { onAddProject: vi.fn() }
		});
		expect(screen.getByText('Add Project')).toBeInTheDocument();
	});

	it('should show "Add Your First Project" button in empty state with callback', () => {
		render(ProjectList, {
			props: { onAddProject: vi.fn() }
		});
		expect(screen.getByText('Add Your First Project')).toBeInTheDocument();
	});

	it('should not show Add Project button when callback not provided', () => {
		render(ProjectList, { props: {} });
		expect(screen.queryByText('Add Project')).not.toBeInTheDocument();
	});

	it('should show description text', () => {
		render(ProjectList, { props: {} });
		expect(screen.getByText('Click a project to open its dashboard')).toBeInTheDocument();
	});

	it('should show Projects header', () => {
		render(ProjectList, { props: {} });
		expect(screen.getByText('Projects')).toBeInTheDocument();
	});
});

describe('Projects index.ts exports', () => {
	let projectExports: any;

	beforeAll(async () => {
		projectExports = await import('$lib/components/projects');
	});

	it('should export all project components', () => {
		expect(projectExports.ProjectCard).toBeDefined();
		expect(projectExports.ProjectList).toBeDefined();
	});
});
