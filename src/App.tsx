import { useState, useEffect, useRef, useCallback } from "react";
import { PixelCanvas } from "./components/Canvas/PixelCanvas";
import { CanvasToolbar } from "./components/Canvas/CanvasToolbar";
import { ColorPalette } from "./components/Palette/ColorPalette";
import { BeadCounter } from "./components/Stats/BeadCounter";
import { ImageImportDialog } from "./components/Import/ImageImportDialog";
import { BlueprintImportDialog } from "./components/Import/BlueprintImportDialog";
import { BlueprintDimsConfirmDialog } from "./components/Import/BlueprintDimsConfirmDialog";
import { ExportDialog } from "./components/Export/ExportDialog";
import { CloudDialog } from "./components/Cloud/CloudDialog";
import { ProjectInfoDialog } from "./components/ProjectInfo/ProjectInfoDialog";
import { ChangesCompareDialog } from "./components/Canvas/ChangesCompareDialog";
import { DialogHost, appPrompt, appAlert, appConfirm } from "./components/Dialog/AppDialog";
import { useEditorStore } from "./store/editorStore";
import { getAdapter } from "./adapters";
import type { BlueprintImportResult, ImagePreview } from "./adapters";
import { MARD_COLORS } from "./data/mard221";
import { getEffectiveColor, getEffectiveHex, type ColorOverrideMap } from "./utils/colorHelper";
import { hasToken, clearGitHubToken, requestDeviceCode, pollForToken, type DeviceCodeInfo } from "./utils/llmVoice";
import { layerAccentColor } from "./utils/layerColors";
import type { HistoryAction, HistoryEntry, CanvasData, CanvasSize } from "./types";

/** Render a small color swatch (or hatched empty marker for null) */
function ColorSwatch({ colorIndex, overrides }: { colorIndex: number | null; overrides: ColorOverrideMap }) {
  if (colorIndex === null) {
    return (
      <span
        className="inline-block w-3 h-3 rounded-sm border border-gray-300 align-middle"
        style={{
          backgroundImage:
            "linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)",
          backgroundSize: "6px 6px",
          backgroundPosition: "0 0, 3px 3px",
        }}
        title="空"
      />
    );
  }
  const hex = getEffectiveHex(colorIndex, overrides);
  const code = MARD_COLORS[colorIndex]?.code ?? "?";
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm border border-gray-300 align-middle"
      style={{ backgroundColor: hex }}
      title={code}
    />
  );
}

/** Render the inline summary of a history action (1-pixel: from→to + pos; many: count) */
function renderActionSummary(action: HistoryAction, overrides: ColorOverrideMap) {
  if (action.kind === "layers") return <span>图层快照</span>;
  const { entries } = action;
  if (entries.length === 1) {
    const e = entries[0];
    return (
      <span className="flex items-center gap-1 min-w-0">
        <ColorSwatch colorIndex={e.prevColorIndex} overrides={overrides} />
        <span className="text-[10px] text-gray-400">→</span>
        <ColorSwatch colorIndex={e.newColorIndex} overrides={overrides} />
        <span className="text-[10px] text-gray-400 ml-1">@({e.col + 1},{e.row + 1})</span>
      </span>
    );
  }
  return <span>{entries.length} 个像素变更</span>;
}

/** Verbose tooltip text describing an action */
function describeAction(action: HistoryAction, overrides: ColorOverrideMap): string {
  if (action.kind === "layers") return "图层快照（结构性操作）";
  const label = (idx: number | null) => {
    if (idx === null) return "空";
    const c = MARD_COLORS[idx];
    if (!c) return "?";
    const ov = overrides.get(idx);
    return ov ? `${c.code}(${ov.hex})` : `${c.code} ${c.name}`;
  };
  const fmt = (e: HistoryEntry) => `(${e.col + 1},${e.row + 1}) ${label(e.prevColorIndex)} → ${label(e.newColorIndex)}`;
  const { entries } = action;
  if (entries.length <= 5) return entries.map(fmt).join("\n");
  const head = entries.slice(0, 5).map(fmt).join("\n");
  return `${head}\n... 共 ${entries.length} 个像素变更`;
}

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
  const [autosaveDir, setAutosaveDir] = useState<string | null>(null);
  const [compareSnapshot, setCompareSnapshot] = useState<{
    canvasData: CanvasData;
    canvasSize: CanvasSize;
    name: string;
  } | null>(null);
  const [blueprintImporting, setBlueprintImporting] = useState(false);
  const [blueprintDimsPending, setBlueprintDimsPending] = useState<{
    path: string;
    preview: ImagePreview;
    detectedWidth: number;
    detectedHeight: number;
    detectedBBox: { left: number; top: number; right: number; bottom: number };
    hasMetadata: boolean;
  } | null>(null);
  const [blueprintProgress, setBlueprintProgress] = useState("");
  const [blueprintProgressFraction, setBlueprintProgressFraction] = useState(0);
  const [blueprintAbort, setBlueprintAbort] = useState<AbortController | null>(null);
  const [blueprintResult, setBlueprintResult] = useState<BlueprintImportResult | null>(null);
  // Captured at the moment the user first confirms in the dims dialog —
  // remembered so that 「重新导入 W×H」 in the preview dialog can re-run
  // importBlueprint against the same file + bbox without bouncing back to
  // the dims dialog.
  const [blueprintReimportCtx, setBlueprintReimportCtx] = useState<{
    path: string;
    bbox?: { left: number; top: number; right: number; bottom: number };
  } | null>(null);
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
  const mergeLayerDown = useEditorStore((s) => s.mergeLayerDown);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const showActiveLayerTag = useEditorStore((s) => s.showActiveLayerTag);
  const setShowActiveLayerTag = useEditorStore((s) => s.setShowActiveLayerTag);
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
  const deleteSnapshot = useEditorStore((s) => s.deleteSnapshot);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const setSelectedColor = useEditorStore((s) => s.setSelectedColor);
  const setHighlightColor = useEditorStore((s) => s.setHighlightColor);

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

  // Resolve the autosave directory path lazily, so the (i) tooltip in the
  // snapshot dialog can show the actual on-disk location.
  useEffect(() => {
    if (!showSnapshots) return;
    if (autosaveDir !== null) return;
    let cancelled = false;
    getAdapter()
      .getAutosaveDir()
      .then((dir) => {
        if (!cancelled) setAutosaveDir(dir ?? "");
      })
      .catch(() => {
        if (!cancelled) setAutosaveDir("");
      });
    return () => {
      cancelled = true;
    };
  }, [showSnapshots, autosaveDir]);

  // Refresh the snapshot list when the 版本管理 dialog opens, but only if
  // the store is empty — preserves test-injected state.
  useEffect(() => {
    if (showSnapshots && snapshots.length === 0) {
      loadSnapshots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSnapshots]);

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

  const handleStatColorActivate = (colorIndex: number) => {
    setSelectedColor(colorIndex);
    setHighlightColor(colorIndex);
    setRightTab("palette");
  };

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
          aria-label="保存到新文件"
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

            // Fast pre-detection + thumbnail in parallel. Slow-spinner state
            // here so the user has feedback even though detect_blueprint_dims
            // returns in <1s for typical inputs.
            setBlueprintImporting(true);
            setBlueprintProgress("正在分析图纸结构...");
            try {
              const [preview, dims] = await Promise.all([
                adapter.previewImage(path),
                adapter.detectBlueprintDims(path),
              ]);
              setBlueprintImporting(false);
              setBlueprintDimsPending({
                path,
                preview,
                detectedWidth: dims.width,
                detectedHeight: dims.height,
                detectedBBox: dims.bbox,
                hasMetadata: dims.hasMetadata,
              });
            } catch (e) {
              setBlueprintImporting(false);
              await appAlert(`图纸分析失败: ${e}`);
            }
          }}
          disabled={blueprintImporting}
          className={`px-2 py-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${blueprintImporting ? "opacity-50" : ""}`}
        >
          导入图纸
          <span
            className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded font-semibold tracking-wider"
            title="自动识别尚在实验阶段，建议核对网格尺寸"
          >
            BETA
          </span>
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
          onClick={() => setShowSnapshots(true)}
          className="px-2 py-1 rounded hover:bg-gray-200"
        >
          版本
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
            {rightTab === "stats" && <BeadCounter onColorActivate={handleStatColorActivate} />}
            {rightTab === "layers" && (
              <div className="p-2 flex flex-col gap-2 text-xs overflow-y-auto">
                {/* Bead layers (top = rendered last = highest) */}
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-600">拼豆图层</span>
                  <button
                    onClick={async () => {
                      const name = await appPrompt("图层名称", `图层 ${layers.length + 1}`, { title: "新建图层" });
                      if (name !== null) addLayer(name || `图层 ${layers.length + 1}`);
                    }}
                    className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600"
                  >
                    + 新建图层
                  </button>
                </div>

                {layers.length > 1 && (
                  <label
                    className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none border border-gray-200 rounded px-2 py-1 bg-white"
                    title="鼠标在画布上时显示当前激活图层的浮动提示"
                  >
                    <input
                      type="checkbox"
                      checked={showActiveLayerTag}
                      onChange={(e) => setShowActiveLayerTag(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span>画布上显示浮动图层提示</span>
                  </label>
                )}

                {[...layers].reverse().map((layer) => {
                  const isActive = layer.id === activeLayerId;
                  const layerIdx = layers.findIndex((l) => l.id === layer.id);
                  const accent = layerAccentColor(layerIdx);
                  return (
                    <div
                      key={layer.id}
                      className={`relative border rounded p-1.5 pl-2.5 transition-colors ${
                        isActive
                          ? "bg-blue-200/70 border-2 border-blue-500 shadow-sm"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div
                        className={`absolute left-0 top-0 bottom-0 rounded-l ${
                          isActive ? "w-1.5" : "w-1 opacity-70"
                        }`}
                        style={{ background: accent }}
                        aria-hidden
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={layer.visible}
                          onChange={(e) => setLayerVisible(layer.id, e.target.checked)}
                          className="w-3 h-3"
                        />
                        <button
                          onClick={() => setActiveLayer(layer.id)}
                          onDoubleClick={async () => {
                            const name = await appPrompt("重命名图层", layer.name, { title: "重命名图层" });
                            if (name !== null && name.trim()) renameLayer(layer.id, name.trim());
                          }}
                          className={`flex-1 text-left truncate ${
                            isActive ? "font-bold text-blue-900 text-sm" : "text-gray-600"
                          }`}
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
                        {layerIdx > 0 && (
                          <button
                            onClick={async () => {
                              const lower = layers[layerIdx - 1];
                              const ok = await appConfirm(
                                `向下合并？「${layer.name}」将并入「${lower.name}」，合并为一层。\n切换图层前可用 Ctrl+Z 撤销。`,
                                { title: "合并图层" },
                              );
                              if (ok) mergeLayerDown(layer.id);
                            }}
                            className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                            title="合并到下层（与下方图层合为一层）"
                          >合并到下层</button>
                        )}
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold">正在导入图纸</div>
            <div className="text-xs text-gray-600 truncate" title={blueprintProgress}>{blueprintProgress}</div>
            <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(blueprintProgressFraction * 100)}%` }} />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => blueprintAbort?.abort()}
                className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50"
              >取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Blueprint pre-import dims confirmation (BETA) */}
      {blueprintDimsPending && (
        <BlueprintDimsConfirmDialog
          filePath={blueprintDimsPending.path}
          detectedWidth={blueprintDimsPending.detectedWidth}
          detectedHeight={blueprintDimsPending.detectedHeight}
          detectedBBox={blueprintDimsPending.detectedBBox}
          hasMetadata={blueprintDimsPending.hasMetadata}
          preview={blueprintDimsPending.preview}
          onCancel={() => setBlueprintDimsPending(null)}
          onRedetect={async (bbox, opts) => {
            const adapter = getAdapter();
            return await adapter.detectBlueprintDims(blueprintDimsPending.path, bbox, opts);
          }}
          onConfirm={async (w, h, bbox) => {
            const pending = blueprintDimsPending;
            setBlueprintDimsPending(null);
            const adapter = getAdapter();
            const controller = new AbortController();
            setBlueprintImporting(true);
            setBlueprintAbort(controller);
            setBlueprintProgress(`正在导入 ${w}×${h} 图纸...`);
            setBlueprintProgressFraction(0);
            try {
              const palette = MARD_COLORS
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.rgb)
                .map(({ c, i }) => {
                  const eff = getEffectiveColor(i, colorOverrides);
                  return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
                });
              setBlueprintProgress("正在识别颜色...");
              const result = await adapter.importBlueprint(
                pending.path,
                palette,
                w,
                h,
                undefined,
                bbox,
                {
                  onProgress: (stage, frac) => {
                    setBlueprintProgress(stage);
                    setBlueprintProgressFraction(frac);
                  },
                  signal: controller.signal,
                },
              );
              setBlueprintResult(result);
              setBlueprintReimportCtx({ path: pending.path, bbox });
            } catch (e) {
              if ((e as Error)?.name !== "AbortError") {
                await appAlert(`图纸导入失败: ${e}`);
              }
            } finally {
              setBlueprintImporting(false);
              setBlueprintAbort(null);
            }
          }}
        />
      )}

      {/* Blueprint Import Preview Dialog */}
      {blueprintResult && (
        <BlueprintImportDialog
          result={blueprintResult}
          onClose={() => { setBlueprintResult(null); setBlueprintReimportCtx(null); }}
          onReimport={blueprintReimportCtx ? async (w, h) => {
            const adapter = getAdapter();
            const palette = MARD_COLORS
              .map((c, i) => ({ c, i }))
              .filter(({ c }) => c.rgb)
              .map(({ c, i }) => {
                const eff = getEffectiveColor(i, colorOverrides);
                return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
              });
            return await adapter.importBlueprint(
              blueprintReimportCtx.path,
              palette,
              w,
              h,
              undefined,
              blueprintReimportCtx.bbox,
            );
          } : undefined}
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
            setBlueprintReimportCtx(null);
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
                    // When the host (currently VS Code) manages document tabs,
                    // route through it so a fresh untitled_<ts>.pindou tab opens.
                    // Otherwise the current tab keeps the previously opened file's
                    // path, risking an accidental overwrite on save.
                    const hostNew = (window as any).__pindouRequestNewProject as
                      | ((w: number, h: number) => void)
                      | undefined;
                    if (typeof hostNew === "function") {
                      hostNew(newW, newH);
                    } else {
                      newCanvas(newW, newH);
                    }
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
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[70vh] flex flex-col">
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
              {/* Local-only notice (persistent, info-pill style) */}
              <div className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                📍 快照保存在本地应用数据目录，换设备或重装应用会丢失
              </div>

              {/* Create snapshot */}
              <div className="flex gap-2 items-center">
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
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[10px] cursor-help select-none"
                  title={
                    autosaveDir
                      ? `保存位置：${autosaveDir}\n如需长期保存请用列表中的「另存为」`
                      : "快照保存在本机的应用数据目录。如需长期保存请用列表中的「另存为」"
                  }
                  aria-label="快照存储位置说明"
                >
                  i
                </span>
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
                          try {
                            const proj = await getAdapter().loadSnapshot(s.path);
                            setCompareSnapshot({
                              canvasData: proj.canvasData,
                              canvasSize: proj.canvasSize,
                              name: s.name,
                            });
                          } catch (e) {
                            await appAlert(`加载快照失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                      >
                        对比
                      </button>
                      <button
                        onClick={async () => {
                          await restoreSnapshot(s.path);
                          setShowSnapshots(false);
                        }}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
                      >
                        恢复
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const project = await getAdapter().loadSnapshot(s.path);
                            const suggested = `${s.name.replace(/[\\/:*?"<>|]/g, "_")}.pindou`;
                            const target = await getAdapter().showSaveDialog(
                              [{ name: "PinDou Project", extensions: ["pindou"] }],
                              suggested,
                            );
                            if (!target) return;
                            await getAdapter().writeProjectFile(target, project);
                            await appAlert(`已导出到: ${target}`, { title: "导出成功" });
                          } catch (e) {
                            await appAlert(
                              `导出失败: ${e instanceof Error ? e.message : String(e)}`,
                              { title: "导出失败" },
                            );
                          }
                        }}
                        className="px-2 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                        title="导出为独立 .pindou 文件"
                      >
                        另存为
                      </button>
                      <button
                        onClick={async () => {
                          if (!(await appConfirm(`确认删除快照「${s.name}」？此操作不可撤销。`, { title: "删除快照" }))) return;
                          try {
                            await deleteSnapshot(s.path);
                          } catch (e) {
                            await appAlert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                          }
                        }}
                        title="删除快照"
                        className="px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50 shrink-0"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Snapshot compare dialog */}
      {compareSnapshot && (
        <ChangesCompareDialog
          onClose={() => setCompareSnapshot(null)}
          baselineData={compareSnapshot.canvasData}
          baselineSize={compareSnapshot.canvasSize}
          baselineLabel={`快照: ${compareSnapshot.name}`}
          currentLabel="当前"
          title="与快照对比"
        />
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
                        title={describeAction(action, colorOverrides)}
                      >
                        <span className="w-5 text-center text-[10px]">↪</span>
                        {renderActionSummary(action, colorOverrides)}
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
                        title={describeAction(action, colorOverrides)}
                      >
                        <span className="w-5 text-center text-[10px]">↩</span>
                        {renderActionSummary(action, colorOverrides)}
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
      <DialogHost />
    </div>
  );
}

export default App;
