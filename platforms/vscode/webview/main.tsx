import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "../../../src/App";
import { setAdapter } from "../../../src/adapters";
import { VScodeAdapter, setDocumentLoadHandler, signalReady, requestGitHubToken } from "../src/vscodeAdapter";
import { useEditorStore } from "../../../src/store/editorStore";
import { setGitHubToken, clearGitHubToken } from "../../../src/utils/llmVoice";
import "./styles.css";

// Initialize VS Code adapter
const adapter = new VScodeAdapter();
setAdapter(adapter);

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

// Handle document load from extension host
setDocumentLoadHandler((content: string, path: string) => {
  try {
    const project = JSON.parse(content);
    if (project.canvasSize && project.canvasData) {
      const store = useEditorStore.getState();
      store.loadCanvasData(
        project.canvasData,
        project.canvasSize
      );
      if (project.gridConfig) {
        useEditorStore.setState({ gridConfig: { ...store.gridConfig, ...project.gridConfig } });
      }
      if (project.projectInfo) {
        useEditorStore.setState({ projectInfo: project.projectInfo });
      }
      useEditorStore.setState({ projectPath: path });
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
