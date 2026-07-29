import { invoke } from '@tauri-apps/api/core';
import { debugStore } from '$lib/stores';

// Store original console methods
const originalConsole = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	info: console.info.bind(console)
};

let interceptorInstalled = false;

/**
 * Format console arguments to a string
 */
function formatArgs(args: unknown[]): string {
	return args
		.map((arg) => {
			if (typeof arg === 'string') return arg;
			if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
			try {
				return JSON.stringify(arg);
			} catch {
				return String(arg);
			}
		})
		.join(' ');
}

/**
 * Send a log entry to the backend (fire and forget)
 */
function sendToBackend(level: string, message: string): void {
	if (!debugStore.isEnabled) return;

	// Don't await - fire and forget to avoid blocking
	invoke('write_frontend_log', {
		level,
		message,
		context: null
	}).catch(() => {
		// Silently fail - use original console to avoid infinite loop
	});
}

/**
 * Install the debug interceptor to capture console logs
 */
export function installDebugInterceptor(): void {
	if (interceptorInstalled) return;

	console.log = (...args: unknown[]) => {
		originalConsole.log(...args);
		sendToBackend('INFO', formatArgs(args));
	};

	console.warn = (...args: unknown[]) => {
		originalConsole.warn(...args);
		sendToBackend('WARN', formatArgs(args));
	};

	console.error = (...args: unknown[]) => {
		originalConsole.error(...args);
		sendToBackend('ERROR', formatArgs(args));
	};

	console.info = (...args: unknown[]) => {
		originalConsole.info(...args);
		sendToBackend('INFO', formatArgs(args));
	};

	interceptorInstalled = true;
	originalConsole.log('[Debug] Console interceptor installed');
}

/**
 * Uninstall the debug interceptor
 */
export function uninstallDebugInterceptor(): void {
	if (!interceptorInstalled) return;

	console.log = originalConsole.log;
	console.warn = originalConsole.warn;
	console.error = originalConsole.error;
	console.info = originalConsole.info;

	interceptorInstalled = false;
	originalConsole.log('[Debug] Console interceptor uninstalled');
}

/**
 * Check if the interceptor is installed
 */
export function isInterceptorInstalled(): boolean {
	return interceptorInstalled;
}

/**
 * Wrapper for Tauri invoke that logs the call when debug mode is enabled
 */
export async function debugInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	const start = performance.now();

	try {
		const result = await invoke<T>(cmd, args);
		const duration = performance.now() - start;

		if (debugStore.isEnabled) {
			// Log successful invoke
			invoke('write_invoke_log', {
				command: cmd,
				durationMs: duration,
				success: true,
				args: args ? JSON.stringify(args) : null,
				error: null
			}).catch(() => {
				// Silently fail
			});
		}

		return result;
	} catch (e) {
		const duration = performance.now() - start;
		const errorMessage = e instanceof Error ? e.message : String(e);

		if (debugStore.isEnabled) {
			// Log failed invoke
			invoke('write_invoke_log', {
				command: cmd,
				durationMs: duration,
				success: false,
				args: args ? JSON.stringify(args) : null,
				error: errorMessage
			}).catch(() => {
				// Silently fail
			});
		}

		throw e;
	}
}
