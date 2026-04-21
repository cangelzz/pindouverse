import { useState, useEffect, useRef, useCallback } from "react";
import { PixelCanvas } from "./components/Canvas/PixelCanvas";
import { CanvasToolbar } from "./components/Canvas/CanvasToolbar";
import { ColorPalette } from "./components/Palette/ColorPalette";
import { BeadCounter } from "./components/Stats/BeadCounter";
import { ImageImportDialog } from "./components/Import/ImageImportDialog";
import { BlueprintImportDialog } from "./components/Import/BlueprintImportDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { CloudDialog } from "./components/Cloud/CloudDialog";
import { ProjectInfoDialog } from "./components/ProjectInfo/ProjectInfoDialog";
import { ChangesCompareDialog } from "./components/Canvas/ChangesCompareDialog";
import { useEditorStore } from "./store/editorStore";
import { getAdapter } from "./adapters";
import type { BlueprintImportResult } from "./adapters";
import { MARD_COLORS } from "./data/mard221";
import { getEffectiveColor } from "./utils/colorHelper";
import { hasToken, clearGitHubToken, requestDeviceCode, pollForToken, type DeviceCodeInfo } from "./utils/llmVoice";

/** Extract hex color (#RRGGBB) from an rgba() string */
function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  const [, r, g, b] = m;
  return "#" + [r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}

/** Extract alpha from an rgba() string (0-1) */
function rgbaAlpha(rgba: string): number {
  const m = rgba.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/);
  return m ? parseFloat(m[1]) : 1;
}

/** Convert hex + alpha to rgba() string */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function App() {
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showProjectInfo, setShowProjectInfo] = useState(false);
  const [showChangesCompare, setShowChangesCompare] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [resizeW, setResizeW] = useState(52);
  const [resizeH, setResizeH] = useState(52);
  const [resizeAnchorRow, setResizeAnchorRow] = useState(0);
  const [resizeAnchorCol, setResizeAnchorCol] = useState(0);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [blueprintImporting, setBlueprintImporting] = useState(false);
  const [blueprintProgress, setBlueprintProgress] = useState("");
  const [blueprintResult, setBlueprintResult] = useState<BlueprintImportResult | null>(null);
  const [rightTab, setRightTab] = useState<"palette" | "stats" | "layers">("palette");

  // GitHub login state
  const [isLoggedIn, setIsLoggedIn] = useState(hasToken());
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginDeviceInfo, setLoginDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [loginPolling, setLoginPolling] = useState(false);

  const newCanvas = useEditorStore((s) => s.newCanvas);
  const isDirty = useEditorStore((s) => s.isDirty);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const projectPath = useEditorStore((s) => s.projectPath);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const baselineCanvasData = useEditorStore((s) => s.baselineCanvasData);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorStore((s) => s.setAutoSaveEnabled);
  const aiVoiceEnabled = useEditorStore((s) => s.aiVoiceEnabled);
  const setAiVoiceEnabled = useEditorStore((s) => s.setAiVoiceEnabled);
  const betaFeatures = useEditorStore((s) => s.betaFeatures);
  const setBetaFeature = useEditorStore((s) => s.setBetaFeature);
  const [showBetaSettings, setShowBetaSettings] = useState(false);
  const saveProject = useEditorStore((s) => s.saveProject);
  const saveProjectAs = useEditorStore((s) => s.saveProjectAs);
  const openProject = useEditorStore((s) => s.openProject);
  const autoSave = useEditorStore((s) => s.autoSave);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const resizeCanvas = useEditorStore((s) => s.resizeCanvas);
  const countLostPixels = useEditorStore((s) => s.countLostPixels);
  const zoom = useEditorStore((s) => s.zoom);
  const refImagePixels = useEditorStore((s) => s.refImagePixels);
  const refImageVisible = useEditorStore((s) => s.refImageVisible);
  const refImageOpacity = useEditorStore((s) => s.refImageOpacity);
  const setRefImageVisible = useEditorStore((s) => s.setRefImageVisible);
  const setRefImageOpacity = useEditorStore((s) => s.setRefImageOpacity);
  const clearRefImage = useEditorStore((s) => s.clearRefImage);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const addLayer = useEditorStore((s) => s.addLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const setLayerVisible = useEditorStore((s) => s.setLayerVisible);
  const setLayerOpacity = useEditorStore((s) => s.setLayerOpacity);
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const gridConfig = useEditorStore((s) => s.gridConfig);
  const setGridStartCoords = useEditorStore((s) => s.setGridStartCoords);
  const setEdgePadding = useEditorStore((s) => s.setEdgePadding);
  const setGridVisible = useEditorStore((s) => s.setGridVisible);
  const setGridLineColor = useEditorStore((s) => s.setGridLineColor);
  const setGridLineWidth = useEditorStore((s) => s.setGridLineWidth);
  const setGridGroupLineColor = useEditorStore((s) => s.setGridGroupLineColor);
  const setGridGroupLineWidth = useEditorStore((s) => s.setGridGroupLineWidth);
  const snapshots = useEditorStore((s) => s.snapshots);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const loadSnapshots = useEditorStore((s) => s.loadSnapshots);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);

  const [newW, setNewW] = useState(52);
  const [newH, setNewH] = useState(52);

  // Resizable right panel
  const [rightPanelWidth, setRightPanelWidth] = useState(224);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  // Auto-collapse sidebar when window is narrow (e.g. VS Code diff view)
  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 600 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
        autoCollapsedRef.current = true;
      } else if (window.innerWidth >= 600 && autoCollapsedRef.current) {
        setSidebarCollapsed(false);
        autoCollapsedRef.current = false;
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [sidebarCollapsed]);
  const isResizingPanel = useRef(false);
  const handlePanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingPanel.current = true;
    const startX = e.clientX;
    const startW = rightPanelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isResizingPanel.current) return;
      const delta = startX - ev.clientX;
      setRightPanelWidth(Math.max(160, Math.min(500, startW + delta)));
    };
    const onUp = () => {
      isResizingPanel.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rightPanelWidth]);

  // Auto-save every 60 seconds
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const id = setInterval(() => autoSaveRef.current(), 60_000);
    return () => clearInterval(id);
  }, [autoSaveEnabled]);

  // Update window title with project name/path
  useEffect(() => {
    const base = "拼豆宇宙 PindouVerse";
    const infoTitle = projectInfo?.title;
    const fileName = projectPath?.replace(/\\/g, "/").split("/").pop();

    let title: string;
    if (infoTitle && fileName) {
      title = `${infoTitle} (${fileName}) - ${base}`;
    } else if (infoTitle) {
      title = `${infoTitle} - ${base}`;
    } else if (projectPath) {
      const fullTitle = `${projectPath} - ${base}`;
      const shortTitle = `${fileName} - ${base}`;
      title = fullTitle.length <= 120 ? fullTitle : shortTitle;
    } else {
      title = base;
    }

    document.title = title;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title).catch(() => {});
    }).catch(() => {});
  }, [projectPath, projectInfo?.title]);

  // Warn before closing with unsaved changes
  useEffect(() => {
    // Browser/webview: beforeunload
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Tauri desktop: listen for window close request
    let unlisten: (() => void) | null = null;
    let isShowingDialog = false;
    let cancelled = false;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      if (cancelled) return;
      const win = getCurrentWindow();
      win.onCloseRequested(async (event) => {
        if (!useEditorStore.getState().isDirty) return;
        if (isShowingDialog) { event.preventDefault(); return; }
        event.preventDefault();
        isShowingDialog = true;
        let shouldClose = false;
        try {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          shouldClose = await ask("有未保存的修改，确定要退出吗？", {
            title: "退出确认",
            kind: "warning",
          });
        } catch {
          // Dialog failed — allow close rather than leaving the window stuck
          shouldClose = true;
        } finally {
          isShowingDialog = false;
        }
        if (shouldClose) {
          unlisten?.();
          unlisten = null;
          await win.close();
        }
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {
      // Not in Tauri environment
    });

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
        <span className="font-bold text-sm mr-2">🎨 拼豆宇宙</span>
        <button
          onClick={() => setShowNewCanvas(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          新建
        </button>
        <button
          onClick={() => {
            setResizeW(canvasSize.width);
            setResizeH(canvasSize.height);
            setResizeAnchorRow(0);
            setResizeAnchorCol(0);
            setShowResize(true);
          }}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          调整画布
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
        <button
          onClick={() => setShowProjectInfo(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
          title="项目信息"
        >
          项目信息
        </button>
        <div className="border-l mx-1 h-4" />
        <button
          onClick={() => setShowImport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导入图片
        </button>
        <button
          onClick={async () => {
            const adapter = getAdapter();
            const path = await adapter.showOpenDialog([
              { name: "Image", extensions: ["png", "jpg", "jpeg", "bmp"] },
            ]);
            if (!path) return;

            // Ask user for grid dimensions (optional, improves accuracy)
            const sizeInput = prompt(
              "输入图纸网格尺寸（宽x高），留空自动检测：\n例如: 100x100 或 52x52",
              ""
            );
            let gridWidth: number | undefined;
            let gridHeight: number | undefined;
            if (sizeInput) {
              const match = sizeInput.match(/(\d+)\s*[x×,]\s*(\d+)/i);
              if (match) {
                gridWidth = parseInt(match[1]);
                gridHeight = parseInt(match[2]);
              }
            }

            setBlueprintImporting(true);
            setBlueprintProgress(gridWidth ? `正在导入 ${gridWidth}×${gridHeight} 图纸...` : "正在自动检测网格...");
            try {
              const palette = MARD_COLORS
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.rgb)
                .map(({ c, i }) => {
                  const eff = getEffectiveColor(i, colorOverrides);
                  return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
                });

              setBlueprintProgress("正在分析网格结构和识别颜色...");
              const result = await adapter.importBlueprint(path, palette, gridWidth, gridHeight);

              setBlueprintImporting(false);
              setBlueprintResult(result);
            } catch (e) {
              alert(`图纸导入失败: ${e}`);
              setBlueprintImporting(false);
            }
          }}
          disabled={blueprintImporting}
          className={`px-2 py-1 rounded hover:bg-gray-200 ${blueprintImporting ? "opacity-50" : ""}`}
        >
          导入图纸
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          导出
        </button>
        <div className="border-l mx-1 h-4" />
        <button
          onClick={() => setShowHistory(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
          title="操作历史"
        >
          历史记录
        </button>
        {baselineCanvasData && (
          <button
            onClick={() => setShowChangesCompare(true)}
            className="px-2 py-1 rounded hover:bg-gray-200"
            title="对比变更"
          >
            对比
          </button>
        )}
        {isLoggedIn && (
          <>
            <button
              onClick={() => setShowCloud(true)}
              className="px-2 py-1 rounded hover:bg-gray-200"
            >
              云端
            </button>
            {cloudGistId && (
              <span className={`text-xs ${isDirty ? "text-orange-500" : "text-green-600"}`}>
                {isDirty ? "☁️●" : "☁️✓"}
              </span>
            )}
          </>
        )}
        <button
          onClick={() => { loadSnapshots(); setShowSnapshots(true); }}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          版本管理
        </button>
        <div className="flex-1" />
        {/* GitHub login/logout */}
        {isLoggedIn ? (
          <button
            onClick={() => {
              clearGitHubToken();
              setIsLoggedIn(false);
            }}
            className="px-2 py-1 rounded hover:bg-gray-200 text-green-600 text-xs"
            title="点击登出 GitHub"
          >
            ✓ GitHub 已登录
          </button>
        ) : (
          <button
            onClick={async () => {
              // VS Code webview provides a native login via window.__pindouLoginGitHub
              const nativeLogin = (window as any).__pindouLoginGitHub;
              if (nativeLogin) {
                const ok = await nativeLogin();
                if (ok) setIsLoggedIn(true);
                return;
              }
              // Tauri/desktop: use device code flow
              setShowLoginDialog(true);
              setLoginStatus("正在请求验证码...");
              setLoginDeviceInfo(null);
              requestDeviceCode().then((info) => {
                setLoginDeviceInfo(info);
                setLoginStatus("请在浏览器中输入验证码");
                import("@tauri-apps/plugin-shell").then(({ open }) => open(info.verification_uri)).catch(() => {
                  window.open(info.verification_uri, "_blank");
                });
                setLoginPolling(true);
                pollForToken(info.device_code, info.interval, info.expires_in, setLoginStatus).then((ok) => {
                  setLoginPolling(false);
                  if (ok) {
                    setIsLoggedIn(true);
                    setTimeout(() => setShowLoginDialog(false), 1000);
                  }
                });
              }).catch((e) => {
                setLoginStatus(`请求失败: ${e}`);
              });
            }}
            className="px-2 py-1 rounded hover:bg-gray-200 text-gray-500 text-xs"
          >
            登录 GitHub
          </button>
        )}
        <button
          onClick={() => {
            const platform = navigator.userAgent.includes("Windows") ? "Windows"
              : navigator.userAgent.includes("Mac") ? "macOS"
              : navigator.userAgent.includes("Linux") ? "Linux" : "Unknown";
            const appVersion = (window as any).__pindouVersion || "dev";
            const isVSCode = typeof (window as any).acquireVsCodeApi === "function"
              || document.body.dataset.vscodeContext !== undefined;
            const env = isVSCode ? "VS Code Extension" : "Desktop (Tauri)";
            const canvas = `${canvasSize.width}x${canvasSize.height}`;
            const body = encodeURIComponent(
              `**描述问题**\n\n\n**复现步骤**\n1. \n2. \n3. \n\n**环境信息**\n- 版本: ${appVersion}\n- 平台: ${platform}\n- 运行环境: ${env}\n- 画布: ${canvas}\n`
            );
            const url = `https://github.com/cangelzz/pindouverse/issues/new?body=${body}`;
            import("@tauri-apps/plugin-shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
          }}
          className="px-2 py-1 rounded hover:bg-gray-200 text-gray-400 text-xs"
        >
          反馈
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left toolbar */}
        <CanvasToolbar />

        {/* Center canvas */}
        <PixelCanvas />

        {/* Right panel (resizable) */}
        <div className="flex min-h-0 relative">
          {!sidebarCollapsed && (
            <>
          {/* Resize handle */}
          <div
            className="w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-400 bg-gray-200 transition-colors"
            onMouseDown={handlePanelResizeStart}
          />
          <div
            className="flex flex-col border-l bg-white min-h-0"
            style={{ width: rightPanelWidth }}
          >
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
              onClick={() => setRightTab("layers")}
              className={`flex-1 py-1.5 ${
                rightTab === "layers"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              图层
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
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="px-1.5 py-1.5 text-gray-300 hover:text-gray-500"
              title="折叠侧边栏"
            >
              ▶
            </button>
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === "palette" && <ColorPalette />}
            {rightTab === "stats" && <BeadCounter />}
            {rightTab === "layers" && (
              <div className="p-2 flex flex-col gap-2 text-xs overflow-y-auto">
                {/* Bead layers (top = rendered last = highest) */}
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-600">拼豆图层</span>
                  <button
                    onClick={() => {
                      const name = prompt("图层名称", `图层 ${layers.length + 1}`);
                      if (name !== null) addLayer(name || `图层 ${layers.length + 1}`);
                    }}
                    className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600"
                  >
                    + 新建图层
                  </button>
                </div>

                {[...layers].reverse().map((layer) => {
                  const isActive = layer.id === activeLayerId;
                  return (
                    <div
                      key={layer.id}
                      className={`border rounded p-1.5 ${isActive ? "bg-blue-50 border-blue-300" : "bg-gray-50"}`}
                    >
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={layer.visible}
                          onChange={(e) => setLayerVisible(layer.id, e.target.checked)}
                          className="w-3 h-3"
                        />
                        <button
                          onClick={() => setActiveLayer(layer.id)}
                          onDoubleClick={() => {
                            const name = prompt("重命名图层", layer.name);
                            if (name !== null && name.trim()) renameLayer(layer.id, name.trim());
                          }}
                          className={`flex-1 text-left truncate ${isActive ? "font-semibold text-blue-700" : "text-gray-600"}`}
                          title="双击重命名"
                        >
                          {layer.name}
                        </button>
                        {isActive && <span className="text-[9px] text-blue-500">✎</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(layer.opacity * 100)}
                          onChange={(e) => setLayerOpacity(layer.id, Number(e.target.value) / 100)}
                          className="flex-1 h-2"
                        />
                        <span className="text-gray-400 w-7 text-right text-[10px]">
                          {Math.round(layer.opacity * 100)}%
                        </span>
                      </div>
                      <div className="flex gap-0.5 mt-1">
                        <button
                          onClick={() => moveLayer(layer.id, "up")}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="上移"
                        >↑</button>
                        <button
                          onClick={() => moveLayer(layer.id, "down")}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="下移"
                        >↓</button>
                        <button
                          onClick={() => duplicateLayer(layer.id)}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title="复制"
                        >复制</button>
                        {layers.length > 1 && (
                          <button
                            onClick={() => removeLayer(layer.id)}
                            className="px-1 py-0 border rounded text-[9px] text-red-400 hover:bg-red-50"
                            title="删除"
                          >删除</button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="border-t my-1" />

                {/* Reference image layer */}
                <div className={`border rounded p-1.5 ${refImagePixels ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-1">
                    {refImagePixels ? (
                      <input
                        type="checkbox"
                        checked={refImageVisible}
                        onChange={(e) => setRefImageVisible(e.target.checked)}
                        className="w-3 h-3"
                      />
                    ) : (
                      <input type="checkbox" disabled className="w-3 h-3 opacity-30" />
                    )}
                    <span className="font-semibold text-gray-600">🖼️ 参考图 (不导出)</span>
                  </div>
                  {refImagePixels ? (
                    <>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(refImageOpacity * 100)}
                          onChange={(e) => setRefImageOpacity(Number(e.target.value) / 100)}
                          className="flex-1 h-2"
                        />
                        <span className="text-gray-400 w-7 text-right text-[10px]">
                          {Math.round(refImageOpacity * 100)}%
                        </span>
                      </div>
                      <button
                        onClick={clearRefImage}
                        className="text-[10px] text-red-400 hover:text-red-600 underline mt-1"
                      >
                        移除
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] text-gray-400 mt-0.5">导入图片时自动设置</p>
                  )}
                </div>

                <div className="border-t my-1" />

                {/* Grid layer */}
                <div className="border rounded p-1.5 bg-gray-50">
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={gridConfig.visible}
                      onChange={(e) => setGridVisible(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="font-semibold text-gray-600">📐 网格</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">边距</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={gridConfig.edgePadding}
                        onChange={(e) => setEdgePadding(Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">格</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">起始列</span>
                      <input
                        type="number"
                        value={gridConfig.startX}
                        onChange={(e) => setGridStartCoords(Number(e.target.value), gridConfig.startY)}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-gray-500 w-12">起始行</span>
                      <input
                        type="number"
                        value={gridConfig.startY}
                        onChange={(e) => setGridStartCoords(gridConfig.startX, Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">细线</span>
                      <input
                        type="color"
                        value={rgbaToHex(gridConfig.lineColor)}
                        onChange={(e) => setGridLineColor(hexToRgba(e.target.value, rgbaAlpha(gridConfig.lineColor)))}
                        className="w-5 h-4 p-0 border rounded cursor-pointer"
                      />
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.5}
                        value={gridConfig.lineWidth}
                        onChange={(e) => setGridLineWidth(Number(e.target.value))}
                        className="w-10 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">px</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">粗线</span>
                      <input
                        type="color"
                        value={rgbaToHex(gridConfig.groupLineColor)}
                        onChange={(e) => setGridGroupLineColor(hexToRgba(e.target.value, rgbaAlpha(gridConfig.groupLineColor)))}
                        className="w-5 h-4 p-0 border rounded cursor-pointer"
                      />
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        value={gridConfig.groupLineWidth}
                        onChange={(e) => setGridGroupLineWidth(Number(e.target.value))}
                        className="w-10 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">px</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
            </>
          )}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-5 flex items-center justify-center border-l bg-gray-50 hover:bg-gray-100 text-gray-300 hover:text-gray-500 text-xs"
              title="展开侧边栏"
            >
              ◀
            </button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showImport && <ImageImportDialog onClose={() => setShowImport(false)} />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showProjectInfo && <ProjectInfoDialog onClose={() => setShowProjectInfo(false)} />}
      {showChangesCompare && <ChangesCompareDialog onClose={() => setShowChangesCompare(false)} />}

      {/* Blueprint Import Progress Modal */}
      {blueprintImporting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <h3 className="font-semibold text-sm">导入图纸中</h3>
            <p className="text-xs text-gray-500 text-center whitespace-pre-line">{blueprintProgress}</p>
          </div>
        </div>
      )}

      {/* Blueprint Import Preview Dialog */}
      {blueprintResult && (
        <BlueprintImportDialog
          result={blueprintResult}
          onClose={() => setBlueprintResult(null)}
          onConfirm={(result) => {
            const codeToIndex = new Map<string, number>();
            MARD_COLORS.forEach((c, i) => codeToIndex.set(c.code, i));
            const canvasData = result.cells.map((row) =>
              row.map((cell) => ({
                colorIndex: cell.final_code ? (codeToIndex.get(cell.final_code) ?? null) : null,
              }))
            );
            useEditorStore.getState().placeImageOnCanvas(
              canvasData,
              result.width,
              result.height,
              result.width,
              result.height,
              0,
              0,
            );
            setBlueprintResult(null);
          }}
        />
      )}

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

      {/* Resize Canvas Dialog */}
      {showResize && (() => {
        const lostPixels = (resizeW !== canvasSize.width || resizeH !== canvasSize.height)
          ? countLostPixels(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol)
          : 0;
        const dw = resizeW - canvasSize.width;
        const dh = resizeH - canvasSize.height;
        const isSameSize = dw === 0 && dh === 0;
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-[340px] p-4">
              <h2 className="font-semibold text-sm mb-3">调整画布</h2>
              <div className="flex flex-col gap-3">
                {/* Size inputs */}
                <div className="flex gap-2 items-center text-xs">
                  <span>宽</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeW}
                    onChange={(e) => setResizeW(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <span>高</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeH}
                    onChange={(e) => setResizeH(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                </div>

                {/* Preview */}
                <div className="text-xs text-gray-500">
                  {canvasSize.width}×{canvasSize.height} → {resizeW}×{resizeH}
                  {!isSameSize && (
                    <span className="ml-1">
                      ({dw >= 0 ? "+" : ""}{dw} 宽, {dh >= 0 ? "+" : ""}{dh} 高)
                    </span>
                  )}
                </div>

                {/* Anchor selector */}
                <div>
                  <div className="text-xs text-gray-500 mb-1">锚点（内容保留位置）</div>
                  <div className="inline-grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((row) =>
                      [0, 1, 2].map((col) => (
                        <button
                          key={`${row}-${col}`}
                          onClick={() => { setResizeAnchorRow(row); setResizeAnchorCol(col); }}
                          className={`w-6 h-6 rounded border text-xs flex items-center justify-center ${
                            resizeAnchorRow === row && resizeAnchorCol === col
                              ? "bg-blue-500 text-white border-blue-600"
                              : "bg-gray-100 hover:bg-gray-200 border-gray-300"
                          }`}
                        >
                          {resizeAnchorRow === row && resizeAnchorCol === col ? "●" : "○"}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Warning for pixel loss */}
                {lostPixels > 0 && (
                  <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                    ⚠ 将裁剪 {lostPixels} 个非空像素
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => {
                      resizeCanvas(resizeW, resizeH, resizeAnchorRow, resizeAnchorCol);
                      setShowResize(false);
                    }}
                    disabled={isSameSize}
                    className={`px-3 py-1.5 text-xs rounded ${
                      isSameSize
                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                        : "bg-blue-500 text-white hover:bg-blue-600"
                    }`}
                  >
                    应用
                  </button>
                  <button
                    onClick={() => setShowResize(false)}
                    className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* History Dialog */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">历史记录</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {undoStack.length === 0 && redoStack.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">暂无操作记录</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {/* Redo entries (future states, shown on top, grayed out) */}
                  {[...redoStack].reverse().map((action, i) => {
                    const stepsForward = redoStack.length - i;
                    return (
                      <button
                        key={`redo-${i}`}
                        onClick={() => {
                          for (let s = 0; s < stepsForward; s++) redo();
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-blue-50 text-gray-400"
                      >
                        <span className="w-5 text-center text-[10px]">↪</span>
                        <span>{action.length} 个像素变更</span>
                      </button>
                    );
                  })}

                  {/* Current state marker */}
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs rounded bg-blue-100 text-blue-700 font-semibold">
                    <span className="w-5 text-center">●</span>
                    <span>当前状态</span>
                  </div>

                  {/* Undo entries (past states, shown below current) */}
                  {[...undoStack].reverse().map((action, i) => {
                    const stepsBack = i + 1;
                    return (
                      <button
                        key={`undo-${i}`}
                        onClick={() => {
                          for (let s = 0; s < stepsBack; s++) undo();
                          setShowHistory(false);
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-orange-50 text-gray-600"
                      >
                        <span className="w-5 text-center text-[10px]">↩</span>
                        <span>{action.length} 个像素变更</span>
                        <span className="text-gray-400 ml-auto text-[10px]">-{stepsBack}步</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t flex justify-end">
              <button
                onClick={() => setShowHistory(false)}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloud && <CloudDialog onClose={() => setShowCloud(false)} />}

      {/* GitHub Login Dialog */}
      {showLoginDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h3 className="font-semibold text-sm mb-2">登录 GitHub</h3>
            {loginDeviceInfo ? (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  请在浏览器中打开下方链接，输入验证码完成授权：
                </p>
                <div className="flex flex-col items-center gap-2 mb-3">
                  <a
                    href={loginDeviceInfo.verification_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 text-xs underline"
                  >
                    {loginDeviceInfo.verification_uri}
                  </a>
                  <div className="text-2xl font-mono font-bold tracking-widest bg-gray-100 px-4 py-2 rounded select-all">
                    {loginDeviceInfo.user_code}
                  </div>
                </div>
                <p className="text-xs text-center text-gray-500">
                  {loginPolling && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-1" />}
                  {loginStatus}
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-500 text-center py-4">{loginStatus}</p>
            )}
            <div className="flex justify-end mt-3">
              <button
                onClick={() => { setShowLoginDialog(false); setLoginDeviceInfo(null); }}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                {loginPolling ? "取消" : "关闭"}
              </button>
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
          自动备份
        </label>
        {betaFeatures.aiVoice && (
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={aiVoiceEnabled}
            onChange={(e) => setAiVoiceEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          AI语音
        </label>
        )}
        <button
          onClick={() => setShowBetaSettings(true)}
          className="text-[10px] text-gray-400 hover:text-gray-600 underline"
        >
          Beta
        </button>
        {lastSavedAt && (
          <span
            className={lastSavedAt.startsWith("自动备份") ? "text-blue-500" : "text-green-600"}
            title={lastSavedAt.startsWith("自动备份") ? "自动备份保存在项目目录的 .pindou_autosave 文件夹中" : undefined}
          >
            {lastSavedAt}
          </span>
        )}
      </div>
      {showBetaSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-sm">Beta 功能</h2>
              <button onClick={() => setShowBetaSettings(false)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">实验性功能，可能不稳定。开启后在菜单栏中显示对应按钮。</p>
            <div className="flex flex-col gap-2 text-xs">
              {Object.entries(betaFeatures).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setBetaFeature(key, e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-gray-600">{
                    key === "blueprintImport" ? "图纸导入（从导出的图纸还原画布）" :
                    key === "aiVoice" ? "AI 语音增强（GitHub Models LLM）" :
                    key
                  }</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
