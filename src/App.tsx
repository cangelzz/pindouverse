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
import { getPlatformServices } from "./platform/serviceRegistry";
import type { BlueprintImportResult, ImagePreview } from "./adapters";
import { MARD_COLORS } from "./data/mard221";
import { getEffectiveColor, getEffectiveHex, type ColorOverrideMap } from "./utils/colorHelper";
import type { DeviceCodeInfo, GitHubSession } from "./platform/services";
import { connectGitHubSession } from "./platform/githubSession";
import { layerAccentColor } from "./utils/layerColors";
import type { HistoryAction, HistoryEntry, CanvasData, CanvasSize } from "./types";
import { createAutosaveScheduler } from "./utils/autosaveScheduler";
import { autosaveErrorKey } from "./utils/autosaveStatus";
import { getLayerDisplayName, normalizeDefaultLayerPromptName } from "./store/defaultLayerNames";
import type { ImageImportAsset } from "./platform/imageImportService";
import { WebImageImportErrorDialog } from "./components/Import/WebImageImportErrorDialog";
import { ImageTaskScheduler } from "./platform/imageTaskScheduler";
import { createImageTaskSchedulerLifecycle } from "./platform/imageTaskSchedulerLifecycle";
import { LanguageSwitch } from "./components/Language/LanguageSwitch";
import { useTranslation } from "react-i18next";
import { i18n as sharedI18n } from "./i18n";
import { blueprintImportErrorKey, type BlueprintImportStage } from "./utils/blueprintImportTS";

/** Render a small color swatch (or hatched empty marker for null) */
function ColorSwatch({ colorIndex, overrides }: { colorIndex: number | null; overrides: ColorOverrideMap }) {
  const { t } = useTranslation();
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
        title={t("import.blueprint.empty")}
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
function renderActionSummary(action: HistoryAction, overrides: ColorOverrideMap, t: ReturnType<typeof useTranslation>["t"]) {
  if (action.kind === "layers") return <span>{t("history.layerSnapshot")}</span>;
  if (action.kind === "projectPatch") return <span>{t("history.projectSnapshot")}</span>;
  const entries = action.changesByLayer.flatMap(group => group.entries);
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
  return <span>{t("history.pixelChanges", { count: entries.length })}</span>;
}

/** Verbose tooltip text describing an action */
function describeAction(action: HistoryAction, overrides: ColorOverrideMap, t: ReturnType<typeof useTranslation>["t"]): string {
  if (action.kind === "layers") return t("history.layerDetail");
  if (action.kind === "projectPatch") return t("history.projectDetail");
  const label = (idx: number | null) => {
    if (idx === null) return t("import.blueprint.empty");
    const c = MARD_COLORS[idx];
    if (!c) return "?";
    const ov = overrides.get(idx);
    return ov ? `${c.code}(${ov.hex})` : `${c.code} ${c.name}`;
  };
  const fmt = (e: HistoryEntry) => `(${e.col + 1},${e.row + 1}) ${label(e.prevColorIndex)} → ${label(e.newColorIndex)}`;
  const entries = action.changesByLayer.flatMap(group => group.entries);
  if (entries.length <= 5) return entries.map(fmt).join("\n");
  const head = entries.slice(0, 5).map(fmt).join("\n");
  return `${head}\n${t("history.moreChanges", { count: entries.length })}`;
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

export interface ImageTaskSource { subscribe(listener: (task: { id: string; createdAt: number }) => void): () => void }

function App({ imageTaskInbox }: { imageTaskInbox?: ImageTaskSource } = {}) {
  const { t, i18n } = useTranslation();
  const [showImport, setShowImport] = useState(false);
  const [imageImportAsset, setImageImportAsset] = useState<ImageImportAsset>();
  const [showWebImageError, setShowWebImageError] = useState(false);
  const schedulerRef = useRef<ImageTaskScheduler | null>(null);
  useEffect(() => createImageTaskSchedulerLifecycle(
    () => new ImageTaskScheduler(getPlatformServices().imageImports, {
      showAsset: (asset) => { setImageImportAsset(asset); setShowImport(true); },
      showError: () => setShowWebImageError(true),
    }),
    imageTaskInbox,
    schedulerRef,
  ).setup(), [imageTaskInbox]);
  const [showExport, setShowExport] = useState(false);
  const [showNewCanvas, setShowNewCanvas] = useState(false);
  const [showNewCanvasWarning, setShowNewCanvasWarning] = useState(false);
  const newCanvasRequestRef = useRef<{
    token: number;
    projectGeneration: number;
    wasDirty: boolean;
  } | null>(null);
  const newCanvasRequestTokenRef = useRef(0);
  const openRequestRef = useRef<{ token: number; projectGeneration: number; contentRevision: number } | null>(null);
  const openRequestTokenRef = useRef(0);
  const [showOpenWarning, setShowOpenWarning] = useState(false);
  const [pendingAutosave, setPendingAutosave] = useState<import("./types").ProjectFile | null>(null);
  const autosaveRecoveryStateRef = useRef<{ projectGeneration: number; contentRevision: number } | null>(null);
  const [showAutosaveRecovery, setShowAutosaveRecovery] = useState(false);
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
  const services = getPlatformServices();
  const capabilities = services.capabilities;
  const isBrowserExtension = capabilities.runtime === "browser-extension";
  const voiceEnhancement = capabilities.ai ? services.voiceEnhancement : undefined;
  const aiAvailable = !!voiceEnhancement;
  const feedbackEnvironment = capabilities.environmentLabel ?? "Desktop";
  const feedbackPlatform = capabilities.platformLabel
    ?? (navigator.userAgent.includes("Windows") ? "Windows"
    : navigator.userAgent.includes("Mac") ? "macOS"
    : navigator.userAgent.includes("Linux") ? "Linux" : "Unknown");
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
  const [blueprintProgress, setBlueprintProgress] = useState<BlueprintImportStage>("loading-image");
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

  // GitHub session belongs to the platform service, independently from AI.
  const [githubSession, setGitHubSession] = useState<GitHubSession | null>(null);
  useEffect(() => connectGitHubSession(services.github, setGitHubSession), [services.github]);
  const isLoggedIn = githubSession !== null;
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [loginDeviceInfo, setLoginDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [loginPolling, setLoginPolling] = useState(false);
  const loginAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => loginAbortRef.current?.abort(), []);

  const newCanvas = useEditorStore((s) => s.newCanvas);
  const isDirty = useEditorStore((s) => s.isDirty);
  const cloudGistId = useEditorStore((s) => s.cloudGistId);
  const cloudSyncStatus = useEditorStore((s) => s.cloudSyncStatus);
  const projectPath = useEditorStore((s) => s.projectPath);
  const projectGeneration = useEditorStore((s) => s.projectGeneration);
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const baselineCanvasData = useEditorStore((s) => s.baselineCanvasData);
  const saveStatus = useEditorStore((s) => s.saveStatus?.revision === s.contentRevision ? s.saveStatus : null);
  const autoSaveEnabled = useEditorStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useEditorStore((s) => s.setAutoSaveEnabled);
  const createAutosaveTicket = useEditorStore((s) => s.createAutosaveTicket);
  const reportAutosaveResult = useEditorStore((s) => s.reportAutosaveResult);
  const voiceEnhancementEnabled = useEditorStore((s) => s.voiceEnhancementEnabled);
  const setVoiceEnhancementEnabled = useEditorStore((s) => s.setVoiceEnhancementEnabled);
  const betaFeatures = useEditorStore((s) => s.betaFeatures);
  const setBetaFeature = useEditorStore((s) => s.setBetaFeature);
  const [showBetaSettings, setShowBetaSettings] = useState(false);
  const saveProject = useEditorStore((s) => s.saveProject);
  const saveProjectAs = useEditorStore((s) => s.saveProjectAs);
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
  const nextDefaultLayerNameIndex = useEditorStore((s) => s.nextDefaultLayerNameIndex);
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
  const exportSnapshot = useEditorStore((s) => s.exportSnapshot);
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

  const requestNewCanvas = useCallback(() => {
    if (showNewCanvas || showNewCanvasWarning) return;
    const token = ++newCanvasRequestTokenRef.current;
    newCanvasRequestRef.current = { token, projectGeneration, wasDirty: isDirty };
    if (isDirty) {
      setShowNewCanvasWarning(true);
    } else {
      setShowNewCanvas(true);
    }
  }, [isDirty, projectGeneration, showNewCanvas, showNewCanvasWarning]);

  const newCanvasRequestIsCurrent = useCallback(() => {
    const request = newCanvasRequestRef.current;
    if (!request || request.token !== newCanvasRequestTokenRef.current) return false;
    const current = useEditorStore.getState();
    return current.projectGeneration === request.projectGeneration;
  }, []);

  const performOpen = useCallback(async () => {
    const request = openRequestRef.current;
    if (!request || request.token !== openRequestTokenRef.current) return;
    const current = useEditorStore.getState();
    if (current.projectGeneration !== request.projectGeneration || current.contentRevision !== request.contentRevision) {
      openRequestRef.current = null;
      return;
    }
    const result = await current.openProject();
    openRequestRef.current = null;
    if (!result.ok && result.code === "stale") await appAlert(t("errors.openStale"));
    else if (!result.ok && result.code !== "cancelled") await appAlert(t("errors.openProject"));
  }, [t]);

  const requestOpenProject = useCallback(() => {
    if (showOpenWarning || openRequestRef.current) return;
    const current = useEditorStore.getState();
    openRequestRef.current = {
      token: ++openRequestTokenRef.current,
      projectGeneration: current.projectGeneration,
      contentRevision: current.contentRevision,
    };
    if (current.isDirty) setShowOpenWarning(true);
    else void performOpen();
  }, [performOpen, showOpenWarning]);

  useEffect(() => {
    const onHostMessage = (event: MessageEvent) => {
      if (event.data?.type === "requestNewProject") requestNewCanvas();
      if (event.data?.type === "requestOpenProject") requestOpenProject();
    };
    window.addEventListener("message", onHostMessage);
    return () => window.removeEventListener("message", onHostMessage);
  }, [requestNewCanvas, requestOpenProject]);

  useEffect(() => {
    if (!isBrowserExtension || services.recovery.availability !== "available") return;
    let cancelled = false;
    const initial = useEditorStore.getState();
    const intent = { projectGeneration: initial.projectGeneration, contentRevision: initial.contentRevision };
    void services.recovery.loadAutosave().then(async (result) => {
      if (cancelled) return;
      if (!result.ok) { await appAlert(sharedI18n.t("recovery.loadError")); return; }
      const current = useEditorStore.getState();
      if (current.projectGeneration !== intent.projectGeneration || current.contentRevision !== intent.contentRevision || current.isDirty) return;
      if (result.value) {
        autosaveRecoveryStateRef.current = intent;
        setPendingAutosave(result.value);
        setShowAutosaveRecovery(true);
      }
    });
    return () => { cancelled = true; };
  }, [isBrowserExtension, services.recovery]);

  const dismissAutosaveRecovery = useCallback(async () => {
    const result = await services.recovery.clearAutosave?.();
    if (result && !result.ok) { await appAlert(t("recovery.deleteError")); return; }
    autosaveRecoveryStateRef.current = null;
    setPendingAutosave(null);
    setShowAutosaveRecovery(false);
  }, [services.recovery, t]);

  const applyAutosaveRecovery = useCallback(async () => {
    if (!pendingAutosave) return;
    const intent = autosaveRecoveryStateRef.current;
    const current = useEditorStore.getState();
    if (!intent || current.projectGeneration !== intent.projectGeneration || current.contentRevision !== intent.contentRevision || current.isDirty) {
      await appAlert(t("recovery.stale"));
      return;
    }
    current.restoreAutosave(pendingAutosave);
    const result = await services.recovery.clearAutosave?.();
    if (result && !result.ok) await appAlert(t("recovery.clearError"));
    autosaveRecoveryStateRef.current = null;
    setPendingAutosave(null);
    setShowAutosaveRecovery(false);
  }, [pendingAutosave, services.recovery, t]);

  useEffect(() => {
    if (!showAutosaveRecovery) return;
    const initialGeneration = useEditorStore.getState().projectGeneration;
    return useEditorStore.subscribe((state) => {
      if (state.projectGeneration === initialGeneration) return;
      autosaveRecoveryStateRef.current = null;
      setPendingAutosave(null);
      setShowAutosaveRecovery(false);
    });
  }, [showAutosaveRecovery]);

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
  const createAutosaveTicketRef = useRef(createAutosaveTicket);
  const reportAutosaveResultRef = useRef(reportAutosaveResult);
  autoSaveRef.current = autoSave;
  createAutosaveTicketRef.current = createAutosaveTicket;
  reportAutosaveResultRef.current = reportAutosaveResult;
  useEffect(() => {
    if (!autoSaveEnabled) return;
    let reportedErrorKey: string | null = null;
    let ticket = createAutosaveTicketRef.current();
    const scheduler = createAutosaveScheduler(
      () => { ticket = createAutosaveTicketRef.current(); return autoSaveRef.current(); },
      async (result) => {
        if (result.ok) {
          if (result.value === "saved") reportAutosaveResultRef.current(result, ticket);
          reportedErrorKey = null;
          return;
        }
        if (!reportAutosaveResultRef.current(result, ticket)) return;
        const errorKey = autosaveErrorKey(ticket, result.code);
        if (result.code === "cancelled" || reportedErrorKey === errorKey) return;
        reportedErrorKey = errorKey;
        await appAlert(sharedI18n.t("recovery.saveError"));
      },
    );
    const id = setInterval(() => { void scheduler.tick(); }, 60_000);
    return () => { clearInterval(id); scheduler.dispose(); };
  }, [autoSaveEnabled]);

  // Resolve the autosave directory path lazily, so the (i) tooltip in the
  // snapshot dialog can show the actual on-disk location.
  useEffect(() => {
    if (isBrowserExtension) return;
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
  }, [showSnapshots, autosaveDir, isBrowserExtension]);

  // Refresh the snapshot list when the 版本管理 dialog opens, but only if
  // the store is empty — preserves test-injected state.
  useEffect(() => {
    if (!showSnapshots || snapshots.length > 0) return;
    let cancelled = false;
    void loadSnapshots().then(async (result) => {
      if (!cancelled && !result.ok && result.code !== "cancelled") {
        await appAlert(sharedI18n.t("snapshots.loadListError"));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSnapshots]);

  // Update window title with project name/path
  useEffect(() => {
    const base = "PindouVerse";
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
    services.window?.setTitle(title);
  }, [projectPath, projectInfo?.title]);

  // Browser owns beforeunload; desktop hosts may add a native close guard.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditorStore.getState().isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const disposeNative = services.window?.installDirtyCloseGuard(
      () => useEditorStore.getState().isDirty,
    );
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      disposeNative?.();
    };
  }, [services.window]);

  const performSave = useCallback(async (action: "save" | "saveAs") => {
    const result = await (action === "save" ? saveProject() : saveProjectAs());
    if (!result.ok && result.code !== "cancelled" && result.code !== "stale") {
      await appAlert(t(action === "save" ? "errors.saveProject" : "errors.saveAs"));
    }
  }, [saveProject, saveProjectAs, t]);

  // Ctrl+S shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          void performSave("saveAs");
        } else {
          void performSave("save");
        }
      } else if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        requestOpenProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [performSave, requestOpenProject]);

  const handleStatColorActivate = (colorIndex: number) => {
    setSelectedColor(colorIndex);
    setHighlightColor(colorIndex);
    setRightTab("palette");
  };

  return (
    <div className="flex flex-col h-screen bg-white text-gray-800">
      {/* Top menu bar: shared by every platform; IDs are the cross-platform contract. */}
      <div data-testid="top-menu" className="flex h-[49px] shrink-0 items-start gap-1 overflow-hidden px-2 py-1 bg-gray-100 border-b text-xs select-none">
        <span data-testid="brand" className="font-bold text-sm mr-2">🎨 {t("brand")}</span>
        <button data-menu-id="new" onClick={requestNewCanvas} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.newProject")}</button>
        <button data-menu-id="resize" onClick={() => { setResizeW(canvasSize.width); setResizeH(canvasSize.height); setResizeAnchorRow(0); setResizeAnchorCol(0); setShowResize(true); }} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.resizeCanvas")}</button>
        <button data-menu-id="open" onClick={requestOpenProject} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+O">{t("menu.openProject")}</button>
        <button data-menu-id="save" onClick={() => { void performSave("save"); }} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+S">{t("menu.save")}</button>
        <button data-menu-id="save-as" onClick={() => { void performSave("saveAs"); }} className="px-2 py-1 rounded hover:bg-gray-200" title="Ctrl+Shift+S" aria-label={t("menu.saveAsAria")}>{t("menu.saveAs")}</button>
        <button data-menu-id="project-info" onClick={() => setShowProjectInfo(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.projectInfo")}</button>
        <div data-separator-id="files" className="border-l mx-1 h-4" />
        <button data-menu-id="import-image" onClick={() => setShowImport(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.importImage")}</button>
        <button
          data-menu-id="import-blueprint"
          onClick={async () => {
            const adapter = getAdapter();
            const path = await adapter.showOpenDialog([
              { name: t("import.image.fileFilter"), extensions: ["png", "jpg", "jpeg", "bmp"] },
            ]);
            if (!path) return;
            setBlueprintImporting(true);
            setBlueprintProgress("loading-image");
            try {
              const [preview, dims] = await Promise.all([
                adapter.previewImage(path),
                adapter.detectBlueprintDims(path),
              ]);
              setBlueprintImporting(false);
              setBlueprintDimsPending({
                path, preview,
                detectedWidth: dims.width,
                detectedHeight: dims.height,
                detectedBBox: dims.bbox,
                hasMetadata: dims.hasMetadata,
              });
            } catch (error) {
              setBlueprintImporting(false);
              await appAlert(t(blueprintImportErrorKey(error)));
            }
          }}
          disabled={blueprintImporting}
          className={`px-2 py-1 rounded hover:bg-gray-200 inline-flex items-center gap-1 ${blueprintImporting ? "opacity-50" : ""}`}
        >
          {t("menu.importBlueprint")} <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded font-semibold tracking-wider">BETA</span>
        </button>
        <button data-menu-id="export" onClick={() => setShowExport(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.export")}</button>
        <div data-separator-id="history" className="border-l mx-1 h-4" />
        <button data-menu-id="history" onClick={() => setShowHistory(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.history")}</button>
        {baselineCanvasData && <button data-menu-id="compare" onClick={() => setShowChangesCompare(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.compare")}</button>}
        {isLoggedIn && <button data-menu-id="cloud" onClick={() => setShowCloud(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.cloud")}</button>}
        {isLoggedIn && cloudGistId && <span data-menu-id="cloud-status" data-cloud-status={cloudSyncStatus} className={`text-xs ${cloudSyncStatus === "remote-newer" ? "text-red-600" : cloudSyncStatus === "local-changes" ? "text-orange-500" : "text-green-600"}`}>{cloudSyncStatus === "synced" ? "☁️✓" : "☁️●"}</span>}
        <button data-menu-id="version" onClick={() => setShowSnapshots(true)} className="px-2 py-1 rounded hover:bg-gray-200">{t("menu.versions")}</button>
        <div className="flex-1" />
        <LanguageSwitch services={services} />
        {isLoggedIn ? (
          <button data-menu-id="logged-in" onClick={async () => {
            const result = await services.github.logout();
            if (!result.ok) await appAlert(sharedI18n.t("github.logoutError"));
          }} className="px-2 py-1 rounded hover:bg-gray-200 text-green-600 text-xs" title={t("menu.logoutTitle")}>✓ {t("menu.loggedIn")}</button>
        ) : (
          <button data-menu-id="login" disabled={services.github.availability === "unsupported" || services.github.configured === false} title={services.github.availability === "unsupported" ? t("github.initializing") : services.github.configured === false ? t("github.notConfigured") : t("github.loginTitle")} onClick={async () => {
            if (!services.github.startDeviceFlow || !services.github.pollDeviceFlow) {
              await services.github.login();
              return;
            }
            const controller = new AbortController();
            loginAbortRef.current?.abort();
            loginAbortRef.current = controller;
            const isCurrent = () => loginAbortRef.current === controller && !controller.signal.aborted;
            setShowLoginDialog(true);
            setLoginDeviceInfo(null);
            setLoginPolling(false);
            setLoginStatus(sharedI18n.t("github.requesting"));
            try {
              const started = await services.github.startDeviceFlow(controller.signal);
              if (!isCurrent()) return;
              if (!started.ok) { setLoginStatus(sharedI18n.t("github.requestFailed")); return; }
              setLoginDeviceInfo(started.value);
              setLoginStatus(sharedI18n.t("github.enterCode"));
              const opened = await services.externalLinks.open(started.value.verification_uri);
              if (!isCurrent()) return;
              if (!opened.ok) setLoginStatus(sharedI18n.t("github.copyLink"));
              setLoginPolling(true);
              const result = await services.github.pollDeviceFlow(
                started.value,
                (status) => {
                  if (!isCurrent()) return;
                  const key = status === "authorization-pending" ? "waiting" : status === "slow-down" ? "slowDown" : status;
                  setLoginStatus(sharedI18n.t(`github.status.${key}`));
                },
                controller.signal,
              );
              if (!isCurrent()) return;
              if (result.ok) setShowLoginDialog(false);
            } catch {
              if (isCurrent()) setLoginStatus(sharedI18n.t("github.requestFailed"));
            } finally {
              if (loginAbortRef.current === controller) {
                loginAbortRef.current = null;
                setLoginPolling(false);
              }
            }
          }} className="px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50 text-gray-500 text-xs">{t("menu.login")}</button>
        )}
        <button data-menu-id="feedback" data-feedback-environment={feedbackEnvironment} onClick={() => {
          const appVersion = (window as any).__pindouVersion || "dev";
          const canvas = `${canvasSize.width}x${canvasSize.height}`;
          const body = encodeURIComponent(`**${t("feedback.description")}**


**${t("feedback.steps")}**
1.
2.
3.

**${t("feedback.environment")}**
- ${t("feedback.version")}: ${appVersion}
- ${t("feedback.platform")}: ${feedbackPlatform}
- ${t("feedback.runtime")}: ${feedbackEnvironment}
- ${t("feedback.canvas")}: ${canvas}
`);
          const url = `https://github.com/cangelzz/pindouverse/issues/new?body=${body}`;
          void services.externalLinks.open(url).then((result) => { if (!result.ok) window.open(url, "_blank"); });
        }} className="px-2 py-1 rounded hover:bg-gray-200 text-gray-400 text-xs">{t("menu.feedback")}</button>
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
            data-testid="right-panel"
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
              {t("palette.title")}
            </button>
            <button
              onClick={() => setRightTab("layers")}
              className={`flex-1 py-1.5 ${
                rightTab === "layers"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t("layers.title")}
            </button>
            <button
              onClick={() => setRightTab("stats")}
              className={`flex-1 py-1.5 ${
                rightTab === "stats"
                  ? "border-b-2 border-blue-500 text-blue-600 font-semibold"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t("stats.title")}
            </button>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="px-1.5 py-1.5 text-gray-300 hover:text-gray-500"
              title={t("layers.collapse")}
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
                  <span className="font-semibold text-gray-600">{t("layers.beadLayers")}</span>
                  <button
                    onClick={async () => {
                      const defaultName = getLayerDisplayName({
                        name: `Layer ${nextDefaultLayerNameIndex}`,
                        defaultNameIndex: nextDefaultLayerNameIndex,
                      });
                      const name = await appPrompt(t("layers.namePrompt"), defaultName, { title: t("layers.new") });
                      if (name !== null) addLayer(normalizeDefaultLayerPromptName(name, defaultName));
                    }}
                    className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] hover:bg-blue-600"
                  >
                    + {t("layers.new")}
                  </button>
                </div>

                {layers.length > 1 && (
                  <label
                    className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none border border-gray-200 rounded px-2 py-1 bg-white"
                    title={t("layers.activeTagHint")}
                  >
                    <input
                      type="checkbox"
                      checked={showActiveLayerTag}
                      onChange={(e) => setShowActiveLayerTag(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span>{t("layers.activeTag")}</span>
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
                            const displayedName = getLayerDisplayName(layer);
                            const name = await appPrompt(t("layers.rename"), displayedName, { title: t("layers.rename") });
                            if (name !== null && name.trim()) renameLayer(layer.id, normalizeDefaultLayerPromptName(name, displayedName));
                          }}
                          className={`flex-1 text-left truncate ${
                            isActive ? "font-bold text-blue-900 text-sm" : "text-gray-600"
                          }`}
                          title={t("layers.renameHint")}
                          data-user-content
                        >
                          {getLayerDisplayName(layer)}
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
                          title={t("layers.moveUp")}
                        >↑</button>
                        <button
                          onClick={() => moveLayer(layer.id, "down")}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title={t("layers.moveDown")}
                        >↓</button>
                        <button
                          onClick={() => duplicateLayer(layer.id, t("layers.copyName", { name: getLayerDisplayName(layer) }))}
                          className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                          title={t("layers.duplicate")}
                        >{t("layers.duplicate")}</button>
                        {layerIdx > 0 && (
                          <button
                            onClick={async () => {
                              const lower = layers[layerIdx - 1];
                              const ok = await appConfirm(
                                t("layers.mergeConfirm", { name: getLayerDisplayName(layer), lower: getLayerDisplayName(lower) }),
                                { title: t("layers.mergeTitle") },
                              );
                              if (ok) mergeLayerDown(layer.id);
                            }}
                            className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                            title={t("layers.mergeHint")}
                          >{t("layers.mergeDown")}</button>
                        )}
                        {layers.length > 1 && (
                          <button
                            onClick={() => removeLayer(layer.id)}
                            className="px-1 py-0 border rounded text-[9px] text-red-400 hover:bg-red-50"
                            title={t("layers.delete")}
                          >{t("layers.delete")}</button>
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
                    <span className="font-semibold text-gray-600">🖼️ {t("layers.reference")}</span>
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
                        {t("layers.remove")}
                      </button>
                    </>
                  ) : (
                    <p className="text-[10px] text-gray-400 mt-0.5">{t("layers.referenceHint")}</p>
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
                    <span className="font-semibold text-gray-600">📐 {t("layers.grid")}</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">{t("layers.padding")}</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={gridConfig.edgePadding}
                        onChange={(e) => setEdgePadding(Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-[9px] text-gray-400">{t("layers.cells")}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">{t("layers.startColumn")}</span>
                      <input
                        type="number"
                        value={gridConfig.startX}
                        onChange={(e) => setGridStartCoords(Number(e.target.value), gridConfig.startY)}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                      <span className="text-gray-500 w-12">{t("layers.startRow")}</span>
                      <input
                        type="number"
                        value={gridConfig.startY}
                        onChange={(e) => setGridStartCoords(gridConfig.startX, Number(e.target.value))}
                        className="w-12 px-1 py-0 border rounded text-center text-[10px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500 w-12">{t("layers.thinLine")}</span>
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
                      <span className="text-gray-500 w-12">{t("layers.thickLine")}</span>
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
              title={t("layers.expand")}
            >
              ◀
            </button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showImport && <ImageImportDialog
        initialAsset={imageImportAsset}
        onInitialAssetReleased={(assetId) => {
          if (imageImportAsset?.source === "web-context-menu") schedulerRef.current?.completeAsset(assetId);
          else getPlatformServices().imageImports.consumeAsset(assetId);
        }}
        onClose={() => {
          const wasLocalFallback = imageImportAsset?.source === "local";
          setShowImport(false); setImageImportAsset(undefined);
          if (wasLocalFallback) schedulerRef.current?.completeError();
        }}
      />}
      {showWebImageError && <WebImageImportErrorDialog
        onClose={() => { setShowWebImageError(false); schedulerRef.current?.completeError(); }}
        onChooseLocal={() => {
          void getPlatformServices().images.chooseLocalImage().then((result) => {
            if (result.ok) { setShowWebImageError(false); setImageImportAsset(result.value); setShowImport(true); }
          });
        }}
      />}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showProjectInfo && <ProjectInfoDialog onClose={() => setShowProjectInfo(false)} />}
      {showChangesCompare && <ChangesCompareDialog onClose={() => setShowChangesCompare(false)} />}

      {/* Blueprint Import Progress Modal */}
      {blueprintImporting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4 flex flex-col gap-3">
            <div className="text-sm font-semibold">{t("import.blueprint.importingTitle")}</div>
            <div className="text-xs text-gray-600 truncate" title={t(`import.blueprint.progress.${blueprintProgress}`)}>{t(`import.blueprint.progress.${blueprintProgress}`)}</div>
            <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(blueprintProgressFraction * 100)}%` }} />
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => blueprintAbort?.abort()}
                className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50"
              >{t("dialogs.cancel")}</button>
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
            setBlueprintProgress("loading-image");
            setBlueprintProgressFraction(0);
            try {
              const palette = MARD_COLORS
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.rgb)
                .map(({ c, i }) => {
                  const eff = getEffectiveColor(i, colorOverrides);
                  return { code: c.code, r: eff.rgb![0], g: eff.rgb![1], b: eff.rgb![2] };
                });
              setBlueprintProgress("matching-colors");
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
                await appAlert(t(blueprintImportErrorKey(e)));
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

      {showOpenWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h2 className="font-semibold text-sm mb-2">{t("project.unsavedTitle")}</h2>
            <p className="text-xs text-gray-600 mb-4">{t("project.openDirty")}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowOpenWarning(false); openRequestRef.current = null; }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">{t("dialogs.cancel")}</button>
              <button onClick={() => { setShowOpenWarning(false); void performOpen(); }} className="px-3 py-1.5 bg-red-500 text-white text-xs rounded hover:bg-red-600">{t("project.continue")}</button>
            </div>
          </div>
        </div>
      )}

      {showAutosaveRecovery && pendingAutosave && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" data-testid="autosave-recovery-dialog">
          <div className="bg-white rounded-lg shadow-xl w-[380px] p-4">
            <h2 className="font-semibold text-sm mb-2">{t("recovery.title")}</h2>
            <p className="text-xs text-gray-600 mb-4">{t("recovery.message")}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { autosaveRecoveryStateRef.current = null; setPendingAutosave(null); setShowAutosaveRecovery(false); }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">{t("recovery.later")}</button>
              <button onClick={() => { void dismissAutosaveRecovery(); }} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50">{t("recovery.delete")}</button>
              <button onClick={() => { void applyAutosaveRecovery(); }} className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600">{t("recovery.restore")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes guard for creating a new project. */}
      {showNewCanvasWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h2 className="font-semibold text-sm mb-2">{t("project.unsavedTitle")}</h2>
            <p className="text-xs text-gray-600 mb-4">{t("project.newDirty")}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowNewCanvasWarning(false);
                  newCanvasRequestRef.current = null;
                }}
                className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
              >
                {t("dialogs.cancel")}
              </button>
              <button
                onClick={() => {
                  setShowNewCanvasWarning(false);
                  if (!newCanvasRequestIsCurrent()) {
                    newCanvasRequestRef.current = null;
                    return;
                  }
                  setShowNewCanvas(true);
                }}
                className="px-3 py-1.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
              >
                {t("project.continue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Canvas Dialog */}
      {showNewCanvas && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <h2 className="font-semibold text-sm mb-3">{t("project.newCanvas")}</h2>
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
                <span>{t("canvas.width")}</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  value={newW}
                  onChange={(e) => setNewW(Number(e.target.value))}
                  className="w-16 px-2 py-1 border rounded"
                />
                <span>{t("canvas.height")}</span>
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
                    if (!newCanvasRequestIsCurrent()) {
                      setShowNewCanvas(false);
                      newCanvasRequestRef.current = null;
                      return;
                    }
                    const request = newCanvasRequestRef.current;
                    if (request && !request.wasDirty && useEditorStore.getState().isDirty) {
                      request.wasDirty = true;
                      setShowNewCanvas(false);
                      setShowNewCanvasWarning(true);
                      return;
                    }
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
                    newCanvasRequestRef.current = null;
                  }}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  {t("project.create")}
                </button>
                <button
                  onClick={() => {
                    setShowNewCanvas(false);
                    newCanvasRequestRef.current = null;
                  }}
                  className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                >
                  {t("dialogs.cancel")}
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
              <h2 className="font-semibold text-sm mb-3">{t("canvas.resize")}</h2>
              <div className="flex flex-col gap-3">
                {/* Size inputs */}
                <div className="flex gap-2 items-center text-xs">
                  <span>{t("canvas.width")}</span>
                  <input
                    type="number"
                    min={4}
                    max={256}
                    value={resizeW}
                    onChange={(e) => setResizeW(Math.max(4, Math.min(256, Number(e.target.value))))}
                    className="w-16 px-2 py-1 border rounded"
                  />
                  <span>{t("canvas.height")}</span>
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
                      ({dw >= 0 ? "+" : ""}{dw} {t("canvas.width")}, {dh >= 0 ? "+" : ""}{dh} {t("canvas.height")})
                    </span>
                  )}
                </div>

                {/* Anchor selector */}
                <div>
                  <div className="text-xs text-gray-500 mb-1">{t("canvas.anchor")}</div>
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
                    ⚠ {t("canvas.cropWarning", { count: lostPixels })}
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
                    {t("canvas.apply")}
                  </button>
                  <button
                    onClick={() => setShowResize(false)}
                    className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
                  >
                    {t("dialogs.cancel")}
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
              <h2 className="font-semibold text-sm">{t("snapshots.manageTitle")}</h2>
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
                {isBrowserExtension
                  ? t("snapshots.browserNotice")
                  : t("snapshots.desktopNotice")}
              </div>

              {/* Create snapshot */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder={t("snapshots.notePlaceholder")}
                  className="flex-1 px-2 py-1 text-xs border rounded"
                />
                <button
                  onClick={async () => {
                    const result = await createSnapshot(snapshotLabel || t("snapshots.defaultName"));
                    if (result.ok) setSnapshotLabel("");
                    else if (result.code !== "cancelled") await appAlert(sharedI18n.t("snapshots.createError"));
                  }}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                >
                  {t("snapshots.create")}
                </button>
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 text-gray-500 text-[10px] cursor-help select-none"
                  title={isBrowserExtension
                    ? t("snapshots.browserNotice")
                    : autosaveDir
                      ? t("snapshots.storedAt", { path: autosaveDir })
                      : t("snapshots.localStorage")
                  }
                  aria-label={t("snapshots.location")}
                >
                  i
                </span>
              </div>

              {/* Snapshot list */}
              {snapshots.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">{t("snapshots.empty")}</p>
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
                            const result = await getPlatformServices().recovery.loadSnapshot(s.path);
                            if (!result.ok) throw result.cause ?? new Error(result.code);
                            const project = "project" in result.value ? result.value.project : result.value;
                            setCompareSnapshot({
                              canvasData: project.canvasData,
                              canvasSize: project.canvasSize,
                              name: s.name,
                            });
                          } catch (e) {
                            await appAlert(sharedI18n.t("snapshots.loadError"));
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                      >
                        {t("snapshots.compare")}
                      </button>
                      <button
                        onClick={async () => {
                          if (!s.sourceProjectId || s.sourceProjectId !== useEditorStore.getState().projectId) {
                            const proceed = await appConfirm(sharedI18n.t("snapshots.foreignConfirm"), { title: sharedI18n.t("snapshots.restoreTitle") });
                            if (!proceed) return;
                          }
                          const result = await restoreSnapshot(s);
                          if (result.ok) setShowSnapshots(false);
                          else if (result.code !== "cancelled") await appAlert(sharedI18n.t("snapshots.restoreError"));
                        }}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 shrink-0"
                      >
                        {t("snapshots.restore")}
                      </button>
                      <button
                        onClick={async () => {
                          const result = await exportSnapshot(s.path, s.name);
                          if (result.ok) await appAlert(sharedI18n.t("snapshots.exported"), { title: sharedI18n.t("snapshots.exportSuccess") });
                          else if (result.code !== "cancelled") await appAlert(sharedI18n.t("snapshots.exportError"), { title: sharedI18n.t("snapshots.exportFailure") });
                        }}
                        className="px-2 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 shrink-0"
                        title={t("snapshots.saveAsHint")}
                      >
                        {t("snapshots.saveAs")}
                      </button>
                      <button
                        onClick={async () => {
                          if (!(await appConfirm(sharedI18n.t("snapshots.deleteConfirm", { name: s.name }), { title: sharedI18n.t("snapshots.delete") }))) return;
                          try {
                            await deleteSnapshot(s.path);
                          } catch (e) {
                            await appAlert(sharedI18n.t("snapshots.deleteError"));
                          }
                        }}
                        title={t("snapshots.delete")}
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
          baselineLabel={t("snapshots.snapshotLabel", { name: compareSnapshot.name })}
          currentLabel={t("compare.current")}
          title={t("snapshots.compareTitle")}
        />
      )}

      {/* History Dialog */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex justify-between items-center">
              <h2 className="font-semibold text-sm">{t("history.title")}</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {undoStack.length === 0 && redoStack.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">{t("history.empty")}</p>
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
                        title={describeAction(action, colorOverrides, t)}
                      >
                        <span className="w-5 text-center text-[10px]">↪</span>
                        {renderActionSummary(action, colorOverrides, t)}
                      </button>
                    );
                  })}

                  {/* Current state marker */}
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs rounded bg-blue-100 text-blue-700 font-semibold">
                    <span className="w-5 text-center">●</span>
                    <span>{t("history.current")}</span>
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
                        title={describeAction(action, colorOverrides, t)}
                      >
                        <span className="w-5 text-center text-[10px]">↩</span>
                        {renderActionSummary(action, colorOverrides, t)}
                        <span className="text-gray-400 ml-auto text-[10px]">{t("history.steps", { count: stepsBack })}</span>
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
                {t("dialogs.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloud && <CloudDialog onClose={() => setShowCloud(false)} />}

      {showLoginDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[360px] p-4">
            <h3 className="font-semibold text-sm mb-2">{t("github.loginTitle")}</h3>
            {loginDeviceInfo ? <>
              <p className="text-xs text-gray-500 mb-3">{t("github.instructions")}</p>
              <div className="flex flex-col items-center gap-2 mb-3">
                <a href={loginDeviceInfo.verification_uri} target="_blank" rel="noopener noreferrer" className="text-blue-500 text-xs underline">{loginDeviceInfo.verification_uri}</a>
                <div className="text-2xl font-mono font-bold tracking-widest bg-gray-100 px-4 py-2 rounded select-all">{loginDeviceInfo.user_code}</div>
              </div>
            </> : null}
            <p className="text-xs text-center text-gray-500">{loginPolling && <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-1" />}{loginStatus}</p>
            <div className="flex justify-end mt-3"><button onClick={() => { const current = loginAbortRef.current; loginAbortRef.current = null; current?.abort(); setLoginPolling(false); setShowLoginDialog(false); setLoginDeviceInfo(null); setLoginStatus(""); }} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">{t(loginPolling ? "github.cancel" : "github.close")}</button></div>
          </div>
        </div>
      )}

      {/* Bottom status bar */}
      <div className="flex items-center gap-3 px-3 py-0.5 bg-gray-100 border-t text-[10px] text-gray-500 select-none">
        <span>{t("status.canvas")}: {canvasSize.width}×{canvasSize.height}</span>
        <span>{t("status.zoom")}: {Math.round(zoom * 100)}%</span>
        {projectPath && (
          <span className="truncate max-w-[200px]" title={projectPath}>
            {projectPath.split("\\").pop()}
          </span>
        )}
        <div className="flex-1" />
        {isDirty && <span className="text-orange-500">● {t("status.unsaved")}</span>}
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSaveEnabled}
            onChange={(e) => setAutoSaveEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          {t("status.autosave")}
        </label>
        {aiAvailable && betaFeatures.voiceEnhancement && (
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={voiceEnhancementEnabled}
            onChange={(e) => setVoiceEnhancementEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          {t("voice.toggle")}
        </label>
        )}
        <button
          data-testid="beta-settings"
          onClick={() => setShowBetaSettings(true)}
          className="text-[10px] text-gray-400 hover:text-gray-600 underline"
        >
          Beta
        </button>
        {saveStatus && (
          <span
            data-testid="save-status"
            className={saveStatus.kind === "autosaved" ? "text-blue-500" : "text-green-600"}
            title={saveStatus.kind === "autosaved" ? t("status.autosaveHint") : undefined}
          >
            {t(`status.${saveStatus.kind}`, { time: new Date(saveStatus.at).toLocaleTimeString(i18n.language) })}
          </span>
        )}
      </div>
      {showBetaSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[320px] p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-sm">{t("beta.settingsTitle")}</h2>
              <button onClick={() => setShowBetaSettings(false)} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">{t("beta.description")}</p>
            <div className="flex flex-col gap-2 text-xs">
              {Object.entries(betaFeatures).filter(([key]) => key !== "voiceEnhancement" || aiAvailable).map(([key, value]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setBetaFeature(key, e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-gray-600">{
                    key === "blueprintImport" ? t("beta.blueprintImport") :
                    key === "voiceEnhancement" ? t("beta.voiceEnhancement") : key
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
