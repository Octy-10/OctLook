import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { isMac } from "./lib/platform";
import "./styles/global.css";

// Lets styles follow the platform's window chrome (macOS keeps its traffic lights).
document.documentElement.dataset.platform = isMac ? "mac" : "windows";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
