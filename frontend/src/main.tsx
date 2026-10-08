import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { InspectionWorkspace as App } from "./pages/InspectionWorkspace";
import "./styles.css";
import "./connected.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
