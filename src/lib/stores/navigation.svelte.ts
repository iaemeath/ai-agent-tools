import type { TranslationKey } from "$lib/i18n";

export type Page =
  | "dashboard"
  | "settings"
  | "hooks"
  | "instructions"
  | "memory"
  | "mcp"
  | "skills"
  | "rules"
  | "plugins"
  | "git"
  | "terminal"
  | "analytics"
  | "templates"
  | "sessions"
  | "pipelines"
  | "token-savings"
  | "context-engine"
  | "keybindings";

export interface NavItem {
  id: Page;
  label: string;
  labelKey: TranslationKey;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", labelKey: "nav.dashboard", icon: "chart" },
  { id: "settings", label: "Settings", labelKey: "nav.settings", icon: "gear" },
  { id: "hooks", label: "Hooks", labelKey: "nav.hooks", icon: "bolt" },
  { id: "instructions", label: "Instructions", labelKey: "nav.instructions", icon: "book" },
  { id: "memory", label: "Memory", labelKey: "nav.memory", icon: "brain" },
  { id: "mcp", label: "MCP Servers", labelKey: "nav.mcp", icon: "server" },
  { id: "skills", label: "Skills & Agents", labelKey: "nav.skills", icon: "sparkles" },
  { id: "rules", label: "Rules", labelKey: "nav.rules", icon: "shield" },
  { id: "plugins", label: "Plugins", labelKey: "nav.plugins", icon: "puzzle" },
  { id: "git", label: "Git", labelKey: "nav.git", icon: "git" },
  { id: "pipelines", label: "Pipelines", labelKey: "nav.pipelines", icon: "pipelines" },
  { id: "sessions", label: "Sessions", labelKey: "nav.sessions", icon: "sessions" },
  { id: "templates", label: "Templates", labelKey: "nav.templates", icon: "templates" },
  { id: "terminal", label: "Terminal", labelKey: "nav.terminal", icon: "terminal" },
  { id: "analytics", label: "Analytics", labelKey: "nav.analytics", icon: "analytics" },
  { id: "token-savings", label: "Token Savings", labelKey: "nav.token-savings", icon: "savings" },
  { id: "context-engine", label: "Context Engine", labelKey: "nav.context-engine", icon: "network" },
  { id: "keybindings", label: "Keybindings", labelKey: "nav.keybindings", icon: "keybindings" },
];

let currentPage = $state<Page>("dashboard");

export function navigateTo(page: Page) {
  currentPage = page;
}

export function getCurrentPage(): Page {
  return currentPage;
}
