import { invoke } from '@tauri-apps/api/core';

class DebugState {
	isEnabled = $state(false);
	logFilePath = $state<string | null>(null);
	isLoading = $state(false);

	/**
	 * Load the current debug state from the backend
	 */
	async load(): Promise<void> {
		try {
			this.isEnabled = await invoke<boolean>('is_debug_mode_enabled');
			if (this.isEnabled) {
				this.logFilePath = await invoke<string | null>('get_debug_log_path');
			}
		} catch (e) {
			console.error('Failed to load debug state:', e);
		}
	}

	/**
	 * Enable debug mode
	 */
	async enable(): Promise<void> {
		this.isLoading = true;
		try {
			this.logFilePath = await invoke<string>('enable_debug_mode');
			this.isEnabled = true;
		} catch (e) {
			console.error('Failed to enable debug mode:', e);
			throw e;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Disable debug mode
	 */
	async disable(): Promise<void> {
		this.isLoading = true;
		try {
			await invoke('disable_debug_mode');
			this.isEnabled = false;
			// Keep the log file path for reference
		} catch (e) {
			console.error('Failed to disable debug mode:', e);
			throw e;
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Toggle debug mode
	 */
	async toggle(): Promise<void> {
		if (this.isEnabled) {
			await this.disable();
		} else {
			await this.enable();
		}
	}

	/**
	 * Open the logs folder in the file explorer
	 */
	async openLogsFolder(): Promise<void> {
		try {
			await invoke('open_logs_folder');
		} catch (e) {
			console.error('Failed to open logs folder:', e);
			throw e;
		}
	}

	/**
	 * Write a log entry to the debug log
	 */
	async log(message: string, context?: string): Promise<void> {
		if (!this.isEnabled) return;
		try {
			await invoke('write_frontend_log', {
				level: 'INFO',
				message,
				context: context || null
			});
		} catch {
			// Silently fail for logging
		}
	}

	/**
	 * Write a warning log entry
	 */
	async warn(message: string, context?: string): Promise<void> {
		if (!this.isEnabled) return;
		try {
			await invoke('write_frontend_log', {
				level: 'WARN',
				message,
				context: context || null
			});
		} catch {
			// Silently fail for logging
		}
	}

	/**
	 * Write an error log entry
	 */
	async error(message: string, context?: string): Promise<void> {
		if (!this.isEnabled) return;
		try {
			await invoke('write_frontend_log', {
				level: 'ERROR',
				message,
				context: context || null
			});
		} catch {
			// Silently fail for logging
		}
	}

	/**
	 * Write an invoke log entry (for tracking Tauri command calls)
	 */
	async logInvoke(
		command: string,
		durationMs: number,
		success: boolean,
		args?: unknown,
		error?: string
	): Promise<void> {
		if (!this.isEnabled) return;
		try {
			await invoke('write_invoke_log', {
				command,
				durationMs,
				success,
				args: args ? JSON.stringify(args) : null,
				error: error || null
			});
		} catch {
			// Silently fail for logging
		}
	}
}

export const debugStore = new DebugState();
