/// Mobile-specific commands (iOS & Android).
/// These are compiled on all platforms but only meaningful on mobile.

#[tauri::command]
pub fn get_mobile_documents_dir() -> Result<String, String> {
    // On mobile, use the app's document directory
    let dir = dirs::document_dir()
        .or_else(|| dirs::data_local_dir())
        .ok_or("Cannot find documents dir")?
        .join("pindouverse");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create dir failed: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn share_file(path: String) -> Result<(), String> {
    // On desktop this is a no-op. On mobile, Tauri plugins handle sharing.
    // This is a placeholder — actual sharing requires tauri-plugin-share
    // which should be added when mobile build tools are available.
    if !std::path::Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }
    Ok(())
}
