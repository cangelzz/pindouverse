use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct ProjectFile {
    pub version: u32,
    #[serde(rename = "canvasSize")]
    pub canvas_size: CanvasSize,
    #[serde(rename = "canvasData")]
    pub canvas_data: Vec<Vec<CellData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub layers: Option<Vec<BeadLayer>>,
    #[serde(rename = "gridConfig", skip_serializing_if = "Option::is_none", default)]
    pub grid_config: Option<GridConfig>,
    #[serde(rename = "projectInfo", skip_serializing_if = "Option::is_none", default)]
    pub project_info: Option<ProjectInfo>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectInfo {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub link: Option<String>,
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
pub struct BeadLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub data: Vec<Vec<CellData>>,
}

#[derive(Debug, Clone, Copy)]
pub struct CellData {
    pub color_index: Option<u32>,
}

impl Serialize for CellData {
    /// v3 flat form: `null` or a number.
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.color_index {
            Some(n) => s.serialize_u32(n),
            None => s.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for CellData {
    /// Accepts either the v2 verbose form `{ "colorIndex": null | number }`
    /// or the v3 flat form `null | number`.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Flat(Option<u32>),
            Verbose {
                #[serde(rename = "colorIndex")]
                color_index: Option<u32>,
            },
        }
        Ok(match Repr::deserialize(d)? {
            Repr::Flat(v) => CellData { color_index: v },
            Repr::Verbose { color_index } => CellData { color_index },
        })
    }
}

#[tauri::command]
pub fn save_project(path: String, mut project: ProjectFile) -> Result<(), String> {
    project.version = 3;
    let json = serde_json::to_string(&project)
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

#[tauri::command]
pub fn delete_snapshot(path: String) -> Result<(), String> {
    let snapshots_dir = dirs::data_local_dir()
        .ok_or("Cannot find local data dir")?
        .join("pindou")
        .join("snapshots");

    let canonical = fs::canonicalize(&path)
        .map_err(|e| format!("Invalid path: {}", e))?;
    let canonical_dir = fs::canonicalize(&snapshots_dir)
        .map_err(|e| format!("Snapshots dir not accessible: {}", e))?;

    if !canonical.starts_with(&canonical_dir) {
        return Err("Path is outside the snapshots directory".to_string());
    }

    fs::remove_file(&canonical).map_err(|e| format!("Delete failed: {}", e))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialises_v2_verbose_cells() {
        let json = r#"{
            "version": 2,
            "canvasSize": { "width": 2, "height": 1 },
            "canvasData": [[{"colorIndex": null}, {"colorIndex": 5}]],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.canvas_data[0][0].color_index, None);
        assert_eq!(p.canvas_data[0][1].color_index, Some(5));
    }

    #[test]
    fn deserialises_v3_flat_cells() {
        let json = r#"{
            "version": 3,
            "canvasSize": { "width": 2, "height": 1 },
            "canvasData": [[null, 7]],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.canvas_data[0][0].color_index, None);
        assert_eq!(p.canvas_data[0][1].color_index, Some(7));
    }

    #[test]
    fn serialises_to_flat_v3_no_indent() {
        let mut p = ProjectFile {
            version: 2,
            canvas_size: CanvasSize { width: 2, height: 1 },
            canvas_data: vec![vec![
                CellData { color_index: None },
                CellData { color_index: Some(5) },
            ]],
            layers: None,
            grid_config: None,
            project_info: None,
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        p.version = 3;
        let s = serde_json::to_string(&p).unwrap();
        assert!(!s.contains('\n'), "expected no newlines, got: {}", s);
        assert!(s.contains("\"canvasData\":[[null,5]]"), "actual: {}", s);
        assert!(s.contains("\"version\":3"), "actual: {}", s);
    }

    #[test]
    fn round_trips_with_layers() {
        let json = r#"{
            "version": 3,
            "canvasSize": { "width": 1, "height": 1 },
            "canvasData": [[3]],
            "layers": [{
                "id": "l1", "name": "底", "visible": true, "opacity": 1.0,
                "data": [[3]]
            }],
            "createdAt": "t", "updatedAt": "t"
        }"#;
        let p: ProjectFile = serde_json::from_str(json).unwrap();
        assert_eq!(p.layers.as_ref().unwrap().len(), 1);
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"data\":[[3]]"), "actual: {}", s);
    }
}
