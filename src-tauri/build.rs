fn main() {
    // `tauri::generate_context!` validates at COMPILE time that `frontendDist`
    // (../build) exists — otherwise it panics and `cargo test` / `cargo run`
    // fail on a fresh clone, since `build/` is gitignored and only produced by
    // `npm run build`. Seed a minimal placeholder so the crate always compiles;
    // the real `beforeBuildCommand` overwrites it for actual bundles.
    let dist = std::path::Path::new("../build");
    if !dist.join("index.html").exists() {
        let _ = std::fs::create_dir_all(dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><title>placeholder</title>",
        );
    }
    tauri_build::build()
}