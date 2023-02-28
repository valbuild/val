import { ValProvider } from "@valbuild/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ValProvider host="/api/val">
      <App />
    </ValProvider>
  </React.StrictMode>
);
