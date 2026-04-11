pub mod commands;
pub mod color;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::image_import::preview_image,
            commands::image_import::import_image,
            commands::image_export::export_image,
            commands::image_export::export_preview,
            commands::project::save_project,
            commands::project::load_project,
            commands::project::get_autosave_dir,
            commands::project::list_autosaves,
            commands::project::save_snapshot,
            commands::project::list_snapshots,
            commands::project::load_snapshot,
            commands::mobile::get_mobile_documents_dir,
            commands::mobile::share_file,
            commands::github_auth::github_request_device_code,
            commands::github_auth::github_poll_token,
            commands::github_auth::github_models_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
