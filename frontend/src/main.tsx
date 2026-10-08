import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConnectedWorkspace as App } from "./pages/ConnectedWorkspace";
import "./styles.css";
import "./connected.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
