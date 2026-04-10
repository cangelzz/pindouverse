use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct ProjectFile {
    pub version: u32,
    #[serde(rename = "canvasSize")]
    pub canvas_size: CanvasSize,
    #[serde(rename = "canvasData")]
    pub canvas_data: Vec<Vec<CellData>>,
    #[serde(rename = "gridConfig", skip_serializing_if = "Option::is_none", default)]
    pub grid_config: Option<GridConfig>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct GridConfig {
    #[serde(rename = "groupSize")]
    pub group_size: u32,
    #[serde(rename = "edgePadding")]
    pub edge_padding: u32,
    #[serde(rename = "startX")]
    pub start_x: i32,
    #[serde(rename = "startY")]
    pub start_y: i32,
    pub visible: bool,
    #[serde(rename = "lineColor")]
    pub line_color: String,
    #[serde(rename = "lineWidth")]
    pub line_width: f64,
    #[serde(rename = "groupLineColor")]
    pub group_line_color: String,
    #[serde(rename = "groupLineWidth")]
    pub group_line_width: f64,
}

#[derive(Serialize, Deserialize)]
pub struct CanvasSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize)]
pub struct CellData {
    #[serde(rename = "colorIndex")]
    pub color_index: Option<u32>,
}

#[tauri::command]
pub fn save_project(path: String, project: ProjectFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_project(path: String) -> Result<ProjectFile, String> {
    let data = fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))?;
    let project: ProjectFile =
        serde_json::from_str(&data).map_err(|e| format!("Parse failed: {}", e))?;
    Ok(project)
}

#[tauri::command]
pub fn get_autosave_dir() -> Result<String, String> {
    let dir = dirs::data_local_dir()
        .ok_or("Cannot find local data dir")?
        .join("pindou")
        .join("autosave");
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir failed: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_autosaves() -> Result<Vec<String>, String> {
    let dir = dirs::data_local_dir()
        .ok_or("Cannot find local data dir")?
        .join("pindou")
        .join("autosave");

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut files: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("Read dir failed: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "pindou")
                .unwrap_or(false)
        })
        .collect();

    // Sort by modified time, newest first
    files.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });

    Ok(files
        .iter()
        .map(|f| f.path().to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub fn save_snapshot(project: ProjectFile, label: String) -> Result<String, String> {
    let dir = dirs::data_local_dir()
        .ok_or("Cannot find local data dir")?
        .join("pindou")
        .join("snapshots");
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir failed: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("{}_{}.pindou", timestamp, sanitize_filename(&label));
    let path = dir.join(&filename);

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Write failed: {}", e))?;

    // Keep only latest 50 snapshots
    cleanup_old_files(&dir, 50);

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_snapshots() -> Result<Vec<SnapshotInfo>, String> {
    let dir = dirs::data_local_dir()
        .ok_or("Cannot find local data dir")?
        .join("pindou")
        .join("snapshots");

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut files: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("Read dir failed: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "pindou")
                .unwrap_or(false)
        })
        .collect();

    files.sort_by(|a, b| {
        let ma = a.metadata().and_then(|m| m.modified()).ok();
        let mb = b.metadata().and_then(|m| m.modified()).ok();
        mb.cmp(&ma)
    });

    let infos: Vec<SnapshotInfo> = files
        .iter()
        .map(|f| {
            let path = f.path();
            let name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let modified = f
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d %H:%M:%S").to_string()
                })
                .unwrap_or_default();
            SnapshotInfo {
                path: path.to_string_lossy().to_string(),
                name,
                modified,
            }
        })
        .collect();

    Ok(infos)
}

#[tauri::command]
pub fn load_snapshot(path: String) -> Result<ProjectFile, String> {
    load_project(path)
}

#[derive(Serialize)]
pub struct SnapshotInfo {
    pub path: String,
    pub name: String,
    pub modified: String,
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(50)
        .collect()
}

fn cleanup_old_files(dir: &Path, keep: usize) {
    if let Ok(entries) = fs::read_dir(dir) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "pindou")
                    .unwrap_or(false)
            })
            .collect();

        files.sort_by(|a, b| {
            let ma = a.metadata().and_then(|m| m.modified()).ok();
            let mb = b.metadata().and_then(|m| m.modified()).ok();
            mb.cmp(&ma)
        });

        for f in files.iter().skip(keep) {
            let _ = fs::remove_file(f.path());
        }
    }
}
