import { useState, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import { getGitHubToken } from "../../utils/llmVoice";
import {
  listProjects,
  uploadProject,
  downloadProject,
  deleteProject,
  listRevisions,
  downloadRevision,
  getGistUpdatedAt,
  type GistProject,
  type GistRevision,
} from "../../utils/gistSync";
import { CloudComparePreview } from "./CloudComparePreview";
import type { ProjectFile } from "../../types";

interface CloudDialogProps {
  onClose: () => void;
}

export function CloudDialog({ onClose }: CloudDialogProps) {
  const [projects, setProjects] = useState<GistProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGist, setSelectedGist] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<GistRevision[] | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [showUploadInput, setShowUploadInput] = useState(false);

  const [compareState, setCompareState] = useState<{
    cloudProject: ProjectFile;
    cloudUpdatedAt: string;
    gistId: string;
    name: string;
  } | null>(null);

  const isDirty = useEditorStore((s) => s.isDirty);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const cloudUpdatedAt = useEditorStore((s) => s.cloudUpdatedAt);
  const cloudProjectName = useEditorStore((s) => s.cloudProjectName);
  const projectPath = useEditorStore((s) => s.projectPath);
  const loadCanvasData = useEditorStore((s) => s.loadCanvasData);
  const setCloudSync = useEditorStore((s) => s.setCloudSync);

  // Derive project name: cloud name > local filename > empty
  const derivedName = cloudProjectName
    || (projectPath ? projectPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.pindou$/, "") || "" : "");

  const token = getGitHubToken();

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects(token);
      setProjects(list);
    } catch (e: any) {
      setError(e.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [token]);

  if (projects === null && !loading && !error) {
    refresh();
  }

  const handleUpload = async (name: string, gistId?: string) => {
    if (!token || !name.trim()) {
      if (!token) setError("未登录 GitHub，请先登录");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (gistId && cloudUpdatedAt) {
        const currentCloudUpdatedAt = await getGistUpdatedAt(token, gistId);
        if (new Date(currentCloudUpdatedAt) > new Date(cloudUpdatedAt)) {
          const { project: cloudProject } = await downloadProject(token, gistId);
          setCompareState({
            cloudProject,
            cloudUpdatedAt: currentCloudUpdatedAt,
            gistId,
            name,
          });
          setLoading(false);
          return;
        }
      }
      await doUpload(name, gistId);
    } catch (e: any) {
      setError(e.message || "Upload failed");
      setLoading(false);
    }
  };

  const doUpload = async (name: string, gistId?: string) => {
    if (!token) {
      setError("未登录 GitHub，请先登录");
      return;
    }
    setLoading(true);
    try {
      const state = useEditorStore.getState();
      const project: ProjectFile = {
        version: 1,
        canvasSize: state.canvasSize,
        canvasData: state.canvasData,
        gridConfig: state.gridConfig,
        createdAt: state.cloudUpdatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = await uploadProject(token, name, project, gistId);
      setCloudSync(result.gistId, result.updatedAt, name);
      useEditorStore.setState({ isDirty: false });
      setShowUploadInput(false);
      // Force re-fetch the full list from GitHub
      setProjects(null);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (gistId: string, name: string) => {
    if (!token) return;
    if (isDirty && !confirm("当前有未保存的修改，下载云端项目将替换当前画布。继续？")) return;
    setLoading(true);
    setError(null);
    try {
      const { project, updatedAt } = await downloadProject(token, gistId);
      loadCanvasData(project.canvasData, project.canvasSize);
      if (project.gridConfig) {
        const store = useEditorStore.getState();
        useEditorStore.setState({
          gridConfig: { ...store.gridConfig, ...project.gridConfig },
        });
      }
      setCloudSync(gistId, updatedAt, name);
      onClose();
    } catch (e: any) {
      setError(e.message || "Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (gistId: string, name: string) => {
    if (!token) return;
    if (!confirm(`确定删除云端项目 "${name}"？此操作不可撤销。`)) return;
    setLoading(true);
    setError(null);
    try {
      await deleteProject(token, gistId);
      if (cloudGistId === gistId) {
        setCloudSync(null, null, null);
      }
      setProjects(null);
    } catch (e: any) {
      setError(e.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const handleShowRevisions = async (gistId: string) => {
    if (!token) return;
    setSelectedGist(gistId);
    setLoading(true);
    try {
      const revs = await listRevisions(token, gistId);
      setRevisions(revs);
    } catch (e: any) {
      setError(e.message || "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreRevision = async (gistId: string, sha: string) => {
    if (!token) return;
    if (isDirty && !confirm("当前有未保存的修改，恢复版本将替换当前画布。继续？")) return;
    setLoading(true);
    try {
      const project = await downloadRevision(token, gistId, sha);
      loadCanvasData(project.canvasData, project.canvasSize);
      if (project.gridConfig) {
        const store = useEditorStore.getState();
        useEditorStore.setState({
          gridConfig: { ...store.gridConfig, ...project.gridConfig },
        });
      }
      onClose();
    } catch (e: any) {
      setError(e.message || "Restore failed");
    } finally {
      setLoading(false);
    }
  };

  if (compareState) {
    const state = useEditorStore.getState();
    return (
      <CloudComparePreview
        localData={state.canvasData}
        localSize={state.canvasSize}
        localTimestamp={state.cloudUpdatedAt || new Date().toISOString()}
        cloudData={compareState.cloudProject.canvasData}
        cloudSize={compareState.cloudProject.canvasSize}
        cloudTimestamp={compareState.cloudUpdatedAt}
        onChooseLocal={async () => {
          setCompareState(null);
          await doUpload(compareState.name, compareState.gistId);
        }}
        onChooseCloud={async () => {
          setCompareState(null);
          await handleDownload(compareState.gistId, compareState.name);
        }}
        onCancel={() => setCompareState(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[440px] max-h-[75vh] flex flex-col">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">☁️ 云端项目</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {error && (
          <div className="mx-4 mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3">
          {loading && projects === null ? (
            <p className="text-xs text-gray-400 text-center py-4">加载中...</p>
          ) : revisions && selectedGist ? (
            <div>
              <button
                onClick={() => { setRevisions(null); setSelectedGist(null); }}
                className="text-xs text-blue-500 hover:underline mb-2"
              >
                ← 返回项目列表
              </button>
              <h3 className="text-xs font-semibold text-gray-600 mb-2">版本历史</h3>
              {revisions.map((rev, i) => (
                <div key={rev.sha} className="flex items-center gap-2 py-1.5 border-b text-xs">
                  <span className="text-gray-400 w-6">{i + 1}</span>
                  <span className="flex-1 text-gray-600">
                    {new Date(rev.committedAt).toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleRestoreRevision(selectedGist, rev.sha)}
                    className="px-2 py-0.5 bg-green-500 text-white rounded text-[10px] hover:bg-green-600"
                  >
                    恢复
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {projects && projects.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">暂无云端项目</p>
              )}
              {projects?.map((p) => (
                <div
                  key={p.gistId}
                  className={`flex items-center gap-2 p-2 rounded border text-xs ${
                    cloudGistId === p.gistId ? "bg-blue-50 border-blue-300" : "bg-gray-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {p.name}
                      {cloudGistId === p.gistId && (
                        <span className="text-blue-500 ml-1 text-[10px]">● 当前</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-[10px]">
                      {new Date(p.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDownload(p.gistId, p.name)}
                    className="px-2 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600 shrink-0"
                  >
                    下载
                  </button>
                  <button
                    onClick={() => handleShowRevisions(p.gistId)}
                    className="px-2 py-0.5 border rounded text-[10px] hover:bg-gray-100 shrink-0"
                  >
                    历史
                  </button>
                  <button
                    onClick={() => handleDelete(p.gistId, p.name)}
                    className="px-2 py-0.5 border rounded text-[10px] text-red-400 hover:bg-red-50 shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t flex gap-2 items-center">
          {showUploadInput ? (
            <>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="项目名称"
                className="flex-1 px-2 py-1 text-xs border rounded"
                autoFocus
              />
              <button
                onClick={() => {
                  let name = uploadName.trim().replace(/\.pindou$/i, "");
                  if (!name) return;
                  const existing = projects?.find((p) => p.name === name);
                  handleUpload(name, existing?.gistId);
                }}
                disabled={!uploadName.trim() || loading}
                className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50"
              >
                上传
              </button>
              <button
                onClick={() => setShowUploadInput(false)}
                className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  if (cloudGistId && derivedName) {
                    // Already linked — sync directly
                    handleUpload(derivedName, cloudGistId);
                  } else if (derivedName) {
                    // Has a name from local file — check if cloud has it, then upload
                    const existing = projects?.find((p) => p.name === derivedName);
                    handleUpload(derivedName, existing?.gistId);
                  } else {
                    // No name at all — ask user
                    setUploadName("");
                    setShowUploadInput(true);
                  }
                }}
                disabled={loading}
                className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {cloudGistId ? "同步到云端" : "上传当前项目"}
              </button>
              <button
                onClick={() => {
                  setUploadName(derivedName);
                  setShowUploadInput(true);
                }}
                disabled={loading}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                另存为...
              </button>
              <button
                onClick={refresh}
                disabled={loading}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {loading ? "加载中..." : "刷新"}
              </button>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100"
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
