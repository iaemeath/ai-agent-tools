// Tool profiles — the single source of truth for per-tool filesystem layout.
//
// Each AI coding tool (Claude Code, ZCode, …) stores its config under a different
// directory and uses a different settings file path. A ToolProfile captures those
// differences so paths.ts / adapters / routes can stay tool-agnostic: they receive a
// profile and derive every path from it. Adding a new tool = adding one entry here.

/** Supported tool identifiers. */
export type ToolId = 'claude' | 'zcode';

/**
 * Filesystem layout of one AI tool's config.
 * Every path in paths.ts is derived from these fields.
 */
export interface ToolProfile {
	/** Tool identifier (also stored on ToolInstance so the UI can group by tool). */
	id: ToolId;
	/** Human-readable name for the UI selector. */
	label: string;
	/** Directory name under home (e.g. '.claude', '.zcode'). */
	configDir: string;
	/** Directory name under a project root (e.g. '.claude', '.zcode'). */
	projectPrefix: string;
	/**
	 * Path segments from configDir to the settings JSON file.
	 * Array form because ZCode nests it ('cli/config.json') while Claude is flat.
	 */
	settingsFile: string[];
	/**
	 * Session-history directory name under configDir (used by allProjectPaths),
	 * or null if the tool has no such folder (ZCode indexes sessions in SQLite).
	 */
	projectsDirRelative: string | null;
	/**
	 * How session-history folder names encode the project path.
	 * 'dash' = Claude's `/` → `-` encoding; null = no encoding (tool not supported).
	 */
	projectEncoding: 'dash' | null;
}

export const PROFILES: Record<ToolId, ToolProfile> = {
	claude: {
		id: 'claude',
		label: 'Claude Code',
		configDir: '.claude',
		projectPrefix: '.claude',
		settingsFile: ['settings.json'],
		projectsDirRelative: 'projects',
		projectEncoding: 'dash',
	},
	zcode: {
		id: 'zcode',
		label: 'ZCode',
		configDir: '.zcode',
		projectPrefix: '.zcode',
		settingsFile: ['cli', 'config.json'],
		projectsDirRelative: null, // ZCode indexes sessions in SQLite, not folders
		projectEncoding: null,
	},
};

/** Default profile used when a caller doesn't specify one (preserves legacy behavior). */
export const DEFAULT_PROFILE: ToolProfile = PROFILES.claude;

/** Resolve a profile by id; unknown ids fall back to the default. */
export function profileOf(id: string): ToolProfile {
	return PROFILES[id as ToolId] ?? DEFAULT_PROFILE;
}
