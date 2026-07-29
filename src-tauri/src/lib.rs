mod commands;
mod paths;

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        #[allow(deprecated)]
        unsafe {
            use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
            NSApp().setActivationPolicy_(
                NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular,
            );
            NSApp().activateIgnoringOtherApps_(cocoa::base::YES);
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                show_window(&window);
            }
        }))
        .setup(|app| {
            // Build tray menu
            let show = MenuItemBuilder::with_id("show", "Show Glyphic").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&show).separator().item(&quit).build()?;

            // Create tray icon
            let icon = Image::from_path("icons/32x32.png")
                .or_else(|_| Image::from_bytes(include_bytes!("../icons/32x32.png")))
                .expect("failed to load tray icon");

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Glyphic")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_window(&window);
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            show_window(&window);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window instead of closing — keeps app in tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
                // Remove from Dock and Cmd+Tab on macOS
                #[cfg(target_os = "macos")]
                {
                    #[allow(deprecated)]
                    unsafe {
                        use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
                        NSApp().setActivationPolicy_(
                            NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
                        );
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::settings::get_claude_capabilities,
            // Projects
            commands::projects::list_projects,
            commands::projects::list_all_projects,
            commands::projects::add_project,
            commands::projects::remove_project,
            commands::projects::open_folder,
            // Hooks
            commands::hooks::get_hooks,
            commands::hooks::set_hooks,
            // Instructions
            commands::instructions::read_instructions,
            commands::instructions::write_instructions,
            commands::instructions::read_referenced_file,
            // MCP
            commands::mcp::list_mcp_servers,
            commands::mcp::upsert_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::get_cloud_mcps,
            // Skills & Agents
            commands::skills::list_skills,
            commands::skills::list_agents,
            commands::skills::write_skill,
            commands::skills::write_agent,
            commands::skills::delete_skill,
            commands::skills::delete_agent,
            // Rules
            commands::rules::list_rules,
            commands::rules::write_rule,
            commands::rules::delete_rule,
            // Commands (slash commands)
            commands::slash_commands::list_commands,
            commands::slash_commands::write_command,
            commands::slash_commands::delete_command,
            // Plugins
            commands::plugins::get_installed_plugins,
            commands::plugins::get_blocked_plugins,
            commands::plugins::get_marketplace_plugins,
            commands::plugins::get_install_counts,
            commands::plugins::install_plugin,
            // Library (canonical resource store + symlink deploy)
            commands::library::list_library,
            commands::library::write_library_item,
            commands::library::delete_library_item,
            commands::library::list_deployments,
            commands::library::deploy_library_item,
            commands::library::undeploy_library_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
