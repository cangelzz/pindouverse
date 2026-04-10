import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";
import { setAdapter } from "../../src/adapters";
import { MobileAdapter } from "../../src/adapters/mobile";

setAdapter(new MobileAdapter());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
