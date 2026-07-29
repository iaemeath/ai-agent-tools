import type { TranslationKey } from "$lib/i18n";

export type Page =
  | "skills"
  | "agents"
  | "mcp"
  | "hooks"
  | "plugins"
  | "rules"
  | "instructions"
  | "settings";

export interface NavItem {
  id: Page;
  label: string;
  labelKey: TranslationKey;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "skills", label: "Skills", labelKey: "nav.skills", icon: "sparkles" },
  { id: "agents", label: "Agents", labelKey: "nav.agents", icon: "bot" },
  { id: "mcp", label: "MCP Servers", labelKey: "nav.mcp", icon: "server" },
  { id: "hooks", label: "Hooks", labelKey: "nav.hooks", icon: "bolt" },
  { id: "plugins", label: "Plugins", labelKey: "nav.plugins", icon: "puzzle" },
  { id: "rules", label: "Rules", labelKey: "nav.rules", icon: "shield" },
  { id: "instructions", label: "Instructions", labelKey: "nav.instructions", icon: "book" },
  { id: "settings", label: "Settings", labelKey: "nav.settings", icon: "gear" },
];

let currentPage = $state<Page>("skills");

export function navigateTo(page: Page) {
  currentPage = page;
}

export function getCurrentPage(): Page {
  return currentPage;
}
