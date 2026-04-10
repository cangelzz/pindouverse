import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { setAdapter } from "./adapters";
import { TauriAdapter } from "./adapters/tauri";

setAdapter(new TauriAdapter());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
