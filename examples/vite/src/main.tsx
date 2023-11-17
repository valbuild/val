import { ValProvider } from "@valbuild/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { config } from "./val.config";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ValProvider config={config}>
      <App />
    </ValProvider>
  </React.StrictMode>
);
