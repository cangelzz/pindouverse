import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "../../../src/App";
import { setAdapter } from "../../../src/adapters";
import { VScodeAdapter, setDocumentLoadHandler, signalReady, requestGitHubToken, requestNewProject } from "../src/vscodeAdapter";
import { useEditorStore } from "../../../src/store/editorStore";
import { setGitHubToken, clearGitHubToken } from "../../../src/utils/llmVoice";
import "./styles.css";

declare const __PINDOU_VERSION__: string;

// Initialize VS Code adapter
const adapter = new VScodeAdapter();
setAdapter(adapter);

(window as any).__pindouVersion = __PINDOU_VERSION__;
// Expose the Zustand store on window for Playwright tests. Harmless in
// production (the global is unreachable from any normal user flow) but
// gives tests a stable hook to read state and dispatch actions.
(window as any).__pindouStore = useEditorStore;
// Expose the platform adapter for Playwright tests (e.g. blueprint import).
// Same rationale as __pindouStore — unreachable from any normal user flow.
(window as any).__pindouAdapter = adapter;

// Provide VS Code-native GitHub login for the app's "登录 GitHub" button.
// App.tsx checks for this function and uses it instead of the Tauri device code flow.
(window as any).__pindouLoginGitHub = async (): Promise<boolean> => {
  const { token } = await requestGitHubToken(true); // createIfNone: true → prompts user
  if (token) {
    setGitHubToken(token);
    return true;
  }
  return false;
};

(window as any).__pindouLogoutGitHub = (): void => {
  clearGitHubToken();
};

// Lets the app route the "新建" toolbar button through the extension host so a
// fresh untitled_<ts>.pindou tab opens instead of mutating the currently open
// file's webview in place. App.tsx checks for this and falls back to the
// in-process newCanvas action when not in VS Code.
(window as any).__pindouRequestNewProject = (width: number, height: number): void => {
  requestNewProject(width, height);
};

// Handle document load from extension host
setDocumentLoadHandler((content: string, path: string, isUntitled: boolean) => {
  try {
    const project = JSON.parse(content);
    if (project.canvasSize && project.canvasData) {
      const store = useEditorStore.getState();
      if (Array.isArray(project.layers) && project.layers.length > 0) {
        store.loadProjectLayers(project.layers, project.canvasSize);
      } else {
        store.loadCanvasData(
          project.canvasData,
          project.canvasSize
        );
      }
      if (project.gridConfig) {
        useEditorStore.setState({ gridConfig: { ...store.gridConfig, ...project.gridConfig } });
      }
      if (project.projectInfo) {
        useEditorStore.setState({ projectInfo: project.projectInfo });
      }
      // For untitled "New Project" temp files, leave projectPath null so Save
      // prompts the user for a real destination instead of overwriting the temp.
      useEditorStore.setState({ projectPath: isUntitled ? null : path });
    }
  } catch (e) {
    console.error("Failed to parse .pindou file:", e);
  }
});

// Wrapper that signals ready AFTER React has mounted,
// so all Zustand store subscriptions are established before data arrives.
// Also auto-requests GitHub token from VS Code's built-in auth.
function WebviewApp() {
  useEffect(() => {
    signalReady();
    // Try to get GitHub token silently (don't prompt if not logged in)
    requestGitHubToken(false).then(({ token }) => {
      if (token) {
        setGitHubToken(token);
      }
    }).catch(() => {
      // Ignore — user not logged in to GitHub in VS Code
    });
  }, []);
  return <App />;
}

// Render the app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<WebviewApp />);
