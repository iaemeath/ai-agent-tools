// Conversation history (ported from cc-switch's session manager, Claude-only).
// Flattened metadata + message stream; no analytics/token fields.

export interface SessionMeta {
	providerId: string;
	sessionId: string;
	title?: string;
	summary?: string;
	projectDir?: string;
	createdAt?: number;
	lastActiveAt?: number;
	sourcePath?: string;
	resumeCommand?: string;
}

export interface SessionMessage {
	role: string;
	content: string;
	ts?: number;
}

export interface DeleteSessionOptions {
	providerId: string;
	sessionId: string;
	sourcePath: string;
}

export interface DeleteSessionResult extends DeleteSessionOptions {
	success: boolean;
	error?: string;
}
