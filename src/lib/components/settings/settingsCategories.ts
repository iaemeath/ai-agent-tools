import { Sliders, ShieldCheck, Variable, ToggleRight, FileSearch, Clock, KeyRound, ServerCog, Keyboard, Bot, Users } from 'lucide-svelte';
import type { TranslationKey } from '$lib/i18n';

export type SettingsCategoryType = 'scoped' | 'standalone';

export interface SettingsCategory {
	id: string;
	/** i18n key resolved via `i18n.t()` at render sites. */
	label: TranslationKey;
	icon: typeof Sliders;
	type: SettingsCategoryType;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
	{ id: 'models', label: 'settings.category.models', icon: Sliders, type: 'scoped' },
	{ id: 'security', label: 'settings.category.security', icon: ShieldCheck, type: 'scoped' },
	{ id: 'environment', label: 'settings.category.environment', icon: Variable, type: 'scoped' },
	{ id: 'interface', label: 'settings.category.interface', icon: ToggleRight, type: 'scoped' },
	{ id: 'files', label: 'settings.category.files', icon: FileSearch, type: 'scoped' },
	{ id: 'session', label: 'settings.category.session', icon: Clock, type: 'scoped' },
	{ id: 'auto-mode', label: 'settings.category.auto-mode', icon: Bot, type: 'scoped' },
	{ id: 'authentication', label: 'settings.category.authentication', icon: KeyRound, type: 'scoped' },
	{ id: 'agent-teams', label: 'settings.category.agent-teams', icon: Users, type: 'scoped' },
	{ id: 'mcp-approval', label: 'settings.category.mcp-approval', icon: ServerCog, type: 'scoped' },
	{ id: 'keybindings', label: 'settings.category.keybindings', icon: Keyboard, type: 'standalone' }
];
