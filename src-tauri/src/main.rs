#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WSLg renders a blank webview: webkit2gtk's dmabuf renderer cannot find a
    // GPU device (Zink/EGL init fails). Force webkit off the dmabuf + compositing
    // paths so the page paints via shared memory. Linux-only; harmless elsewhere.
    #[cfg(target_os = "linux")]
    {
        set_if_unset("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        set_if_unset("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    claude_tool_manager::run()
}

#[cfg(target_os = "linux")]
fn set_if_unset(key: &str, val: &str) {
    if std::env::var(key).is_err() {
        std::env::set_var(key, val);
    }
}
