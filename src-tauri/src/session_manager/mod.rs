pub mod providers;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use providers::claude;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
	pub provider_id: String,
	pub session_id: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub title: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub summary: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub project_dir: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub created_at: Option<i64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub last_active_at: Option<i64>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub source_path: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub resume_command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
	pub role: String,
	pub content: String,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub ts: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionRequest {
	pub provider_id: String,
	pub session_id: String,
	pub source_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionOutcome {
	pub provider_id: String,
	pub session_id: String,
	pub source_path: String,
	pub success: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

/// Scan all Claude Code conversation history under `~/.claude/projects`.
pub fn scan_sessions() -> Vec<SessionMeta> {
	claude::scan_sessions()
}

/// Load the full message stream of a single session (file-based providers only).
pub fn load_messages(provider_id: &str, source_path: &str) -> Result<Vec<SessionMessage>, String> {
	let path = Path::new(source_path);
	match provider_id {
		"claude" => claude::load_messages(path),
		_ => Err(format!("Unsupported provider: {provider_id}")),
	}
}

/// Delete a single session. The source path is validated to live under the
/// provider's root directory (canonicalized) to prevent path-traversal.
pub fn delete_session(
	provider_id: &str,
	session_id: &str,
	source_path: &str,
) -> Result<bool, String> {
	let roots = provider_roots(provider_id)?;
	delete_session_with_roots(provider_id, session_id, Path::new(source_path), &roots)
}

pub fn delete_sessions(requests: &[DeleteSessionRequest]) -> Vec<DeleteSessionOutcome> {
	collect_delete_session_outcomes(requests, |request| {
		delete_session(
			&request.provider_id,
			&request.session_id,
			&request.source_path,
		)
	})
}

fn delete_session_with_roots(
	provider_id: &str,
	session_id: &str,
	source_path: &Path,
	roots: &[PathBuf],
) -> Result<bool, String> {
	let validated_source = canonicalize_existing_path(source_path, "session source")?;

	let mut saw_existing_root = false;
	for root in roots {
		if !root.exists() {
			continue;
		}

		saw_existing_root = true;
		let validated_root = canonicalize_existing_path(root, "session root")?;
		if validated_source.starts_with(&validated_root) {
			return match provider_id {
				"claude" => claude::delete_session(&validated_root, &validated_source, session_id),
				_ => Err(format!("Unsupported provider: {provider_id}")),
			};
		}
	}

	if !saw_existing_root {
		return Err(format!(
			"Session root not found for provider {provider_id}: {}",
			roots
				.first()
				.map(|root| root.display().to_string())
				.unwrap_or_else(|| "<none>".to_string())
		));
	}

	Err(format!(
		"Session source path is outside provider roots: {}",
		source_path.display()
	))
}

fn provider_roots(provider_id: &str) -> Result<Vec<PathBuf>, String> {
	let roots = match provider_id {
		"claude" => crate::utils::paths::get_claude_paths()
			.map(|p| vec![p.claude_dir.join("projects")])
			.map_err(|e| e.to_string())?,
		_ => return Err(format!("Unsupported provider: {provider_id}")),
	};

	Ok(roots)
}

fn canonicalize_existing_path(path: &Path, label: &str) -> Result<PathBuf, String> {
	if !path.exists() {
		return Err(format!("{label} not found: {}", path.display()));
	}

	path.canonicalize()
		.map_err(|e| format!("Failed to resolve {label} {}: {e}", path.display()))
}

fn collect_delete_session_outcomes<F>(
	requests: &[DeleteSessionRequest],
	mut deleter: F,
) -> Vec<DeleteSessionOutcome>
where
	F: FnMut(&DeleteSessionRequest) -> Result<bool, String>,
{
	requests
		.iter()
		.map(|request| match deleter(request) {
			Ok(true) => DeleteSessionOutcome {
				provider_id: request.provider_id.clone(),
				session_id: request.session_id.clone(),
				source_path: request.source_path.clone(),
				success: true,
				error: None,
			},
			Ok(false) => DeleteSessionOutcome {
				provider_id: request.provider_id.clone(),
				session_id: request.session_id.clone(),
				source_path: request.source_path.clone(),
				success: false,
				error: Some("Session was not deleted".to_string()),
			},
			Err(error) => DeleteSessionOutcome {
				provider_id: request.provider_id.clone(),
				session_id: request.session_id.clone(),
				source_path: request.source_path.clone(),
				success: false,
				error: Some(error),
			},
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;
	use tempfile::tempdir;

	fn write_claude_session(path: &Path, session_id: &str) {
		std::fs::write(
			path,
			format!(
				"{{\"sessionId\":\"{session_id}\",\"cwd\":\"/tmp/project\",\"timestamp\":\"2026-03-06T10:00:00Z\"}}\n\
                 {{\"message\":{{\"role\":\"user\",\"content\":\"hello\"}},\"timestamp\":\"2026-03-06T10:01:00Z\"}}\n",
			),
		)
		.expect("write source");
	}

	#[test]
	fn accepts_source_path_under_provider_root() {
		let root = tempdir().expect("root");
		let source = root.path().join("session.jsonl");
		write_claude_session(&source, "session-1");

		delete_session_with_roots(
			"claude",
			"session-1",
			&source,
			&[root.path().to_path_buf()],
		)
		.expect("should delete when under root");

		assert!(!source.exists());
	}

	#[test]
	fn rejects_source_path_outside_provider_root() {
		let root = tempdir().expect("root");
		let outside = tempdir().expect("outside");
		let source = outside.path().join("session.jsonl");
		write_claude_session(&source, "session-2");

		let result = delete_session_with_roots(
			"claude",
			"session-2",
			&source,
			&[root.path().to_path_buf()],
		);

		assert!(result.is_err());
		// File must still exist — deletion refused by the path-traversal guard.
		assert!(source.exists());
	}
}
