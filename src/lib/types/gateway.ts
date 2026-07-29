import type { Mcp } from './mcp';

export type BackendStatus = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'restarting';

/**
 * Metadata about an available MCP (for lazy loading - connection status tracked separately)
 */
export interface AvailableMcp {
	id: number;
	name: string;
	description: string | null;
	mcpType: string;
	status: BackendStatus;
}

export interface BackendInfo {
	mcpId: number;
	mcpName: string;
	mcpType: string;
	status: BackendStatus;
	toolCount: number;
	serverInfo: {
		name: string;
		version?: string;
	} | null;
	errorMessage: string | null;
	restartCount: number;
}

export interface GatewayServerConfig {
	enabled: boolean;
	port: number;
	autoStart: boolean;
}

export interface GatewayServerStatus {
	isRunning: boolean;
	port: number;
	url: string;
	mcpEndpoint: string;
	/** Available MCPs that can be lazily connected */
	availableMcps: AvailableMcp[];
	/** Currently connected backends (lazily loaded) */
	connectedBackends: BackendInfo[];
	/** Total tools from connected backends */
	totalTools: number;
}

export interface GatewayMcp {
	id: number;
	mcpId: number;
	mcp: Mcp;
	isEnabled: boolean;
	autoRestart: boolean;
	displayOrder: number;
	createdAt: string;
}
