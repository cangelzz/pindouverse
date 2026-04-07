import { useState, useEffect, useRef } from "react";
import { PixelCanvas } from "./components/Canvas/PixelCanvas";
import { CanvasToolbar } from "./components/Canvas/CanvasToolbar";
import { ColorPalette } from "./components/Palette/ColorPalette";
import { BeadCounter } from "./components/Stats/BeadCounter";
import { ImageImportDialog } from "./components/Import/ImageImportDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { useEditorStore } from "./store/editorStore";

function App() {
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [rightTab, setRightTab] = useState<"palette" | "stats">("palette");

  const newCanvas = useEditorStore((s) => s.newCanvas);
  const isDirty = useEditorStore((s) => s.isDirty);
  const projectPath = useEditorStore((s) => s.projectPath);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorStore((s) => s.setAutoSaveEnabled);
  const saveProject = useEditorStore((s) => s.saveProject);
  const saveProjectAs = useEditorStore((s) => s.saveProjectAs);
  const openProject = useEditorStore((s) => s.openProject);
  const autoSave = useEditorStore((s) => s.autoSave);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const zoom = useEditorStore((s) => s.zoom);
  const snapshots = useEditorStore((s) => s.snapshots);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const loadSnapshots = useEditorStore((s) => s.loadSnapshots);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);

  const [newW, setNewW] = useState(52);
  const [newH, setNewH] = useState(52);

  // Auto-save every 60 seconds
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const id = setInterval(() => autoSaveRef.current(), 60_000);
    return () => clearInterval(id);
  }, [autoSaveEnabled]);

  // Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          saveProjectAs();
        } else {
          saveProject();
        }
      } else if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        openProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveProject, saveProjectAs, openProject]);

  return (
    <div className="flex flex-col h-screen bg-white text-gray-800">
      {/* Top menu bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 border-b text-xs select-none">
        <span className="font-bold text-sm mr-2">🎨 拼豆编辑器</span>
        <button
          onClick={() => setShowNewCanvas(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          新建
        </button>
        <button
          onClick={() => openProject()}
          className="px-2 py-1 rounded hover:bg-gray-200"
          title="Ctrl+O"
        >
          打开
        </button>
        <button
          onClick={() => saveProject()}
          className="px-2 py-1 rounded hover:bg-gray-200"
          title="Ctrl+S"
        >
          保存
        </button>
        <button
          onClick={() => saveProjectAs()}
          className="px-2 py-1 rounded hover:bg-gray-200"
          title="Ctrl+Shift+S"
        >
          另存为
        </button>
        <div className="border-l mx-1 h-4" />
        <button
          onClick={() => setShowImport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导入图片
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导出
        </button>
        <div className="border-l mx-1 h-4" />
        <button
          onClick={() => { loadSnapshots(); setShowSnapshots(true); }}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          版本管理
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <CanvasToolbar />

        {/* Center canvas */}
        <PixelCanvas />

        {/* Right panel */}
        <div className="flex flex-col w-56 border-l bg-white min-h-0">
          {/* Tabs */}
          <div className="flex border-b text-xs">
            <button
              onClick={() => setRightTab("palette")}
              className={`flex-1 py-1.5 ${
                rightTab === "palette"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              色板
            </button>
            <button
              onClick={() => setRightTab("stats")}
              className={`flex-1 py-1.5 ${
                rightTab === "stats"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              统计
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "palette" ? <ColorPalette /> : <BeadCounter />}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showImport && <ImageImportDialog onClose={() => setShowImport(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}

      {/* New Canvas Dialog */}
      {showNewCanvas && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <h2 className="font-semibold text-sm mb-3">新建画布</h2>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {[
                  { l: "52×52", w: 52, h: 52 },
                  { l: "104×104", w: 104, h: 104 },
                ].map((p) => (
                  <button
                    key={p.l}
                    onClick={() => { setNewW(p.w); setNewH(p.h); }}
                    className={`px-2 py-1 text-xs rounded border ${
                      newW === p.w && newH === p.h
                        ? "bg-blue-100 border-blue-400"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center text-xs">
                <span>宽</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newW}
                  onChange={(e) => setNewW(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
                <span>高</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newH}
                  onChange={(e) => setNewH(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    newCanvas(newW, newH);
                    setShowNewCanvas(false);
                  }}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建
                </button>
                <button
                  onClick={() => setShowNewCanvas(false)}
                  className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Dialog */}
      {showSnapshots && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[420px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">版本管理</h2>
              <button
                onClick={() => setShowSnapshots(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3 overflow-y-auto">
              {/* Create snapshot */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder="版本备注（可选）"
                  className="flex-1 px-2 py-1 text-xs border rounded"
                />
                <button
                  onClick={async () => {
                    await createSnapshot(snapshotLabel || "手动保存");
                    setSnapshotLabel("");
                  }}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  创建快照
                </button>
              </div>

              {/* Snapshot list */}
              {snapshots.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">暂无快照</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {snapshots.map((s) => (
                    <div
                      key={s.path}
                      className="flex items-center gap-2 p-2 bg-gray-50 rounded border text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-gray-400">{s.modified}</div>
                      </div>
                      <button
                        onClick={async () => {
                          await restoreSnapshot(s.path);
                          setShowSnapshots(false);
                        }}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="flex items-center gap-3 px-3 py-0.5 bg-gray-100 border-t text-[10px] text-gray-500 select-none">
        <span>画布: {canvasSize.width}×{canvasSize.height}</span>
        <span>缩放: {Math.round(zoom * 100)}%</span>
        {projectPath && (
          <span className="truncate max-w-[200px]" title={projectPath}>
            {projectPath.split("\\").pop()}
          </span>
        )}
        <div className="flex-1" />
        {isDirty && <span className="text-orange-500">● 未保存</span>}
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(e) => setAutoSaveEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          自动保存
        </label>
        {lastSavedAt && <span className="text-green-600">上次保存: {lastSavedAt}</span>}
      </div>
    </div>
  );
}

export default App;
