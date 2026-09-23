import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "../../../src/App";
import { setAdapter } from "../../../src/adapters";
import { VScodeAdapter, setDocumentLoadHandler, signalReady, requestGitHubToken, requestNewProject, sendRequest, postHostMessage, hasLiveSaveSupport, createToolMediaServices } from "../src/vscodeAdapter";
import { dispatchBlueprintTool, getEditorStamp } from "../../../src/blueprint/toolDispatcher";
import { toolRequestSchema, toolCancelSchema, toolFailure, TOOL_LIMITS, type EditorBinding } from "../../../src/blueprint/toolContract";
import { acquireEditorSessionLock, releaseEditorSessionLock, captureEditorSession, restoreEditorSession, finalizeEditorSave } from "../../../src/store/editorSession";
import { projectFromEditorState } from "../../../src/store/editorStore";
import { useEditorStore } from "../../../src/store/editorStore";
import { VSCodeGitHubService } from "../../../src/platform/vscodeGitHubService";
import { normalizeProjectFromDisk } from "../../../src/utils/projectSerialization";
import { setPlatformServices } from "../../../src/platform/serviceRegistry";
import { createLegacyPlatformServices } from "../../../src/platform/services";
import { VSCodeLocaleService, VSCodeStorageService, VSCodeProjectFileService } from "../src/vscodeServices";
import { bootstrapUiLanguage } from "../../../src/i18n/bootstrap";
import { initializeI18n } from "../../../src/i18n";
import { renderStartupFailure } from "../../../src/i18n/startup";
import { appAlert, appConfirm, appPrompt } from "../../../src/components/Dialog/AppDialog";
import "./styles.css";

declare const __PINDOU_VERSION__: string;

// Initialize VS Code adapter
const adapter = new VScodeAdapter();
setAdapter(adapter);
const githubService = new VSCodeGitHubService(requestGitHubToken);
const mutableCapabilities = {
  runtime: "vscode",
  projectFileHandles: true,
  downloadFallback: false,
  githubDeviceFlow: false,
  gistSync: true,
  ai: false,
  browserImageTasks: true,
  basicVoiceControl: true,
  environmentLabel: "VS Code Extension",
} as const;
const legacyServices = createLegacyPlatformServices(adapter, mutableCapabilities);
const services = {
  ...legacyServices,
  projectFiles: new VSCodeProjectFileService(legacyServices.projectFiles, sendRequest, hasLiveSaveSupport),
  github: githubService,
  storage: new VSCodeStorageService(sendRequest),
  locale: new VSCodeLocaleService(sendRequest),
};
setPlatformServices(services);

(window as any).__pindouVersion = __PINDOU_VERSION__;
// Expose the Zustand store on window for Playwright tests. Harmless in
// production (the global is unreachable from any normal user flow) but
// gives tests a stable hook to read state and dispatch actions.
(window as any).__pindouStore = useEditorStore;
// Expose the platform adapter for Playwright tests (e.g. blueprint import).
// Same rationale as __pindouStore — unreachable from any normal user flow.
(window as any).__pindouAdapter = adapter;
(window as any).__pindouDialogs = { prompt: appPrompt, alert: appAlert, confirm: appConfirm };

// Test seams exercise the real App DOM; production capabilities stay fixed unless a test calls this hook.
(window as any).__pindouTestGitHub = { setSession: (session: any) => githubService.setSessionForTest(session) };
(window as any).__pindouTestPlatform = {
  setCapabilities: (patch: Record<string, unknown>) => {
    Object.assign(mutableCapabilities, patch);
    const canvasSize = useEditorStore.getState().canvasSize;
    useEditorStore.setState({ canvasSize: { ...canvasSize } });
  },
};

// Lets the app route the "新建" toolbar button through the extension host so a
// fresh untitled_<ts>.pindou tab opens instead of mutating the currently open
// file's webview in place. App.tsx checks for this and falls back to the
// in-process newCanvas action when not in VS Code.
(window as any).__pindouRequestNewProject = (width: number, height: number): void => {
  requestNewProject(width, height);
};

// VS Code owns Ctrl+Z / Ctrl+Y. The extension binds those keys (scoped to our
// custom editor) to the pindouverse.undo/redo commands, which post {type:'undo'}
// / {type:'redo'} here. This keeps VS Code's built-in document-text undo from
// reverting the whole .pindou file to its last-saved state — the bug that wiped
// every unsaved edit and emptied the redo stack on a single Ctrl+Z.
//
// __pindouHostHandlesUndo tells PixelCanvas to stand down its own Ctrl+Z/Y
// handler in VS Code so we never undo twice per keypress.
(window as any).__pindouHostHandlesUndo = true;
let languageBootstrapComplete = false;
let latestHostLanguage: { language: "en" | "zh-CN"; revision: number } | null = null;
let appliedLanguageRevision = -1;
async function applyLatestHostLanguage() {
  if (!languageBootstrapComplete || !latestHostLanguage || latestHostLanguage.revision <= appliedLanguageRevision) return;
  const update = latestHostLanguage;
  appliedLanguageRevision = update.revision;
  await initializeI18n(update.language);
  useEditorStore.getState().localizeDefaultLayerNames();
}
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg?.type === "uiLanguageChanged" && (msg.language === "en" || msg.language === "zh-CN") && Number.isInteger(msg.revision) && msg.revision >= 0) {
    if (!latestHostLanguage || msg.revision > latestHostLanguage.revision) latestHostLanguage = { language: msg.language, revision: msg.revision };
    void applyLatestHostLanguage();
    return;
  }
  if (!msg || (msg.type !== "undo" && msg.type !== "redo")) return;
  // A focused text input owns Ctrl+Z for native text editing — don't hijack it.
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const store = useEditorStore.getState();
  if (msg.type === "undo") store.undo();
  else store.redo();
});

let editorBinding: EditorBinding | undefined;
let documentReady = false;
const toolControllers = new Map<string, AbortController>();
const sessionReplies = new Set<string>();
const sessionTypes = new Set(["blueprintCaptureForSave", "blueprintAcquireSession", "blueprintRestoreSession", "blueprintFinalizeSave", "blueprintReleaseSession", "blueprintEnableSession"]);
const onSessionMessage = (event: MessageEvent) => {
  const message = event.data;
  if (!message || !sessionTypes.has(message.type) || typeof message.handoffId !== "string" || typeof message.ownerId !== "string"
    || "requestId" in message || "toolRequestId" in message || sessionReplies.has(message.handoffId)) return;
  sessionReplies.add(message.handoffId);
  if (sessionReplies.size > 256) sessionReplies.delete(sessionReplies.values().next().value!);
  const reply = (value?: unknown, error?: string) => postHostMessage({ type: `${message.type}Result`, handoffId: message.handoffId, value, error });
  try {
    if (!editorBinding || !documentReady) throw new Error("Editor is not ready for session transfer");
    const state = useEditorStore.getState();
    if (message.expectedGeneration !== undefined && message.expectedGeneration !== state.projectGeneration) throw new Error("Project changed during save");
    if (message.expectedRevision !== undefined && message.expectedRevision !== state.contentRevision) throw new Error("Blueprint changed before save");
    switch (message.type) {
      case "blueprintCaptureForSave": {
        const busy = state.getBlueprintBusyReason();
        if (busy) throw new Error(busy);
        reply({ project: projectFromEditorState(state), savedRevision: state.contentRevision });
        break;
      }
      case "blueprintAcquireSession":
        if (!acquireEditorSessionLock(message.ownerId)) throw new Error("Editor is busy; save handoff could not acquire the session");
        reply(captureEditorSession());
        break;
      case "blueprintRestoreSession":
        if (!state.sessionLocked && !acquireEditorSessionLock(message.ownerId)) throw new Error("Destination editor is busy");
        restoreEditorSession(message.snapshot, { displayName: message.path, writable: true }, message.saved);
        reportEditorState();
        reply(getEditorStamp(editorBinding));
        break;
      case "blueprintFinalizeSave":
        if (message.inPlace) finalizeEditorSave(message.saved);
        reply(getEditorStamp(editorBinding));
        break;
      case "blueprintReleaseSession":
      case "blueprintEnableSession":
        releaseEditorSessionLock(message.ownerId);
        reply(getEditorStamp(editorBinding));
        break;
    }
  } catch (error) { reply(undefined, error instanceof Error ? error.message : "Session operation failed"); }
};
window.addEventListener("message", onSessionMessage);
const completedToolIds = new Set<string>();
const reportEditorState = () => {
  if (!editorBinding || !documentReady) return;
  editorBinding = { editorId: editorBinding.editorId, projectGeneration: useEditorStore.getState().projectGeneration };
  postHostMessage({ type: "blueprintEditorReady", stamp: getEditorStamp(editorBinding) });
};
const toolStateSubscription = useEditorStore.subscribe((state, previous) => {
  if (state.projectGeneration !== previous.projectGeneration) {
    for (const controller of toolControllers.values()) controller.abort();
  }
  if (state.contentRevision !== previous.contentRevision || state.projectGeneration !== previous.projectGeneration
    || state.activeLayerId !== previous.activeLayerId || state.isDirty !== previous.isDirty) reportEditorState();
});
const onToolMessage = (event: MessageEvent) => {
  const cancel = toolCancelSchema.safeParse(event.data);
  if (cancel.success) {
    if (cancel.data.editorId === editorBinding?.editorId && cancel.data.projectGeneration === editorBinding.projectGeneration)
      toolControllers.get(cancel.data.toolRequestId)?.abort();
    return;
  }
  const parsed = toolRequestSchema.safeParse(event.data);
  if (!parsed.success || !editorBinding || !documentReady) return;
  const request = parsed.data;
  if (toolControllers.has(request.toolRequestId) || completedToolIds.has(request.toolRequestId)) return;
  const binding = { ...editorBinding };
  const controller = new AbortController();
  if (toolControllers.size >= TOOL_LIMITS.pendingPerEditor) return;
  toolControllers.set(request.toolRequestId, controller);
  void dispatchBlueprintTool(request, binding, controller.signal, request.fileAccess ? createToolMediaServices(request.fileAccess, request.toolRequestId) : undefined)
    .catch(() => toolFailure("outcome_unknown", "Editor operation failed; inspect before retrying"))
    .then(result => postHostMessage({ type: "blueprintToolResponse", toolRequestId: request.toolRequestId,
      editorId: request.editorId, projectGeneration: request.projectGeneration, result }))
    .finally(() => {
      toolControllers.delete(request.toolRequestId);
      completedToolIds.add(request.toolRequestId);
      if (completedToolIds.size > 256) completedToolIds.delete(completedToolIds.values().next().value!);
    });
};
window.addEventListener("message", onToolMessage);
window.addEventListener("unload", () => {
  window.removeEventListener("message", onSessionMessage);
  window.removeEventListener("message", onToolMessage);
  toolStateSubscription();
  for (const controller of toolControllers.values()) controller.abort();
}, { once: true });

// Handle document load from extension host
setDocumentLoadHandler((content: string, path: string, isUntitled: boolean, isBackup: boolean, editorId?: string, sessionOwnerId?: string) => {
  documentReady = false;
  try {
    const project = normalizeProjectFromDisk(content);
    if (project.canvasSize && project.canvasData) {
      // Use the same whole-project load boundary as other platforms so timestamps,
      // document identity, cloud detachment and transient resets cannot drift.
      useEditorStore.getState().loadProjectDocument(project, isUntitled ? null : path, isBackup);
      if (editorId) editorBinding = { editorId, projectGeneration: useEditorStore.getState().projectGeneration };
      if (sessionOwnerId && !acquireEditorSessionLock(sessionOwnerId)) throw new Error("Cannot stage destination editor");
      documentReady = true;
      reportEditorState();
    }
  } catch (e) {
    console.error("Failed to parse .pindou file:", e);
  }
});

// Wrapper that signals ready AFTER React has mounted,
// so all Zustand store subscriptions are established before data arrives.
// Also auto-requests GitHub token from VS Code's built-in auth.
function WebviewApp() {
  const sessionLocked = useEditorStore(state => state.sessionLocked);
  useEffect(() => {
    signalReady();
    void githubService.restore().catch(() => {
      // Ignore — user not logged in to GitHub in VS Code.
    });
  }, []);
  return <div style={{ height: "100%" }} aria-busy={sessionLocked} inert={sessionLocked ? true : undefined}><App /></div>;
}

// Initialize language before mounting. RPCs intentionally happen before ready;
// the host accepts requestId messages as soon as the webview listener is attached.
async function start() {
  try {
    await bootstrapUiLanguage(services);
  } catch {
    await initializeI18n("en");
  }
  useEditorStore.getState().localizeDefaultLayerNames();
  languageBootstrapComplete = true;
  await applyLatestHostLanguage();
  ReactDOM.createRoot(document.getElementById("root")!).render(<WebviewApp />);
}

void start().catch((error) => {
  renderStartupFailure(document.getElementById("root") as HTMLElement, error);
});
