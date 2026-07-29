import type { TranslationKey } from "$lib/i18n";

export type Page =
  | "skills"
  | "mcp"
  | "hooks"
  | "agents"
  | "commands"
  | "plugins"
  | "instructions"
  | "rules"
  | "settings"
  | "projects"
  | "library";

export interface NavItem {
  id: Page;
  label: string;
  labelKey: TranslationKey;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "skills", label: "Skills", labelKey: "nav.skills", icon: "sparkles" },
  { id: "mcp", label: "MCP Servers", labelKey: "nav.mcp", icon: "server" },
  { id: "hooks", label: "Hooks", labelKey: "nav.hooks", icon: "bolt" },
  { id: "agents", label: "Agents", labelKey: "nav.agents", icon: "bot" },
  { id: "commands", label: "Commands", labelKey: "nav.commands", icon: "terminal" },
  { id: "plugins", label: "Plugins", labelKey: "nav.plugins", icon: "puzzle" },
  { id: "instructions", label: "Instructions", labelKey: "nav.instructions", icon: "book" },
  { id: "rules", label: "Rules", labelKey: "nav.rules", icon: "shield" },
  { id: "settings", label: "Settings", labelKey: "nav.settings", icon: "gear" },
  { id: "projects", label: "Projects", labelKey: "nav.projects", icon: "folderOpen" },
  { id: "library", label: "Library", labelKey: "nav.library", icon: "library" },
];

let currentPage = $state<Page>("skills");

export function navigateTo(page: Page) {
  currentPage = page;
}

export function getCurrentPage(): Page {
  return currentPage;
}
