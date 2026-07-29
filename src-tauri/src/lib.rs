mod adapters;
mod commands;
mod core;
mod scan;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_overview,
            commands::get_tool_detail,
            commands::set_tool_status,
            commands::view_tool_content,
            commands::list_projects,
            commands::delete_project,
            commands::promote_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running claude-tool-manager");
}
