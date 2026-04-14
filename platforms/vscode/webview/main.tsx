import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "../../../src/App";
import { setAdapter } from "../../../src/adapters";
import { VScodeAdapter, setDocumentLoadHandler, signalReady } from "../src/vscodeAdapter";
import { useEditorStore } from "../../../src/store/editorStore";
import "../../../src/styles.css";

// Initialize VS Code adapter
const adapter = new VScodeAdapter();
setAdapter(adapter);

// Handle document load from extension host
setDocumentLoadHandler((content: string, _path: string) => {
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
    }
  } catch (e) {
    console.error("Failed to parse .pindou file:", e);
  }
});

// Wrapper that signals ready AFTER React has mounted
function WebviewApp() {
  useEffect(() => {
    // Signal ready only after the component tree is mounted,
    // so all Zustand store subscriptions are established
    signalReady();
  }, []);
  return <App />;
}

// Render the app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<WebviewApp />);
