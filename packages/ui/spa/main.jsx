import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppStatic from "./AppStatic";
import Overlay from "./Overlay";
import { VAL_APP_ID, VAL_OVERLAY_ID } from "../src/constants";

const valAppElem = document.getElementById(VAL_APP_ID);
const valOverlayElem = document.getElementById(VAL_OVERLAY_ID);
const valAppStaticElem = document.getElementById("val-app-static"); // used in index.html

if (valAppElem) {
  ReactDOM.createRoot(valAppElem).render(
    <React.StrictMode>
      <App></App>
    </React.StrictMode>
  );
} else if (valAppStaticElem) {
  ReactDOM.createRoot(valAppStaticElem).render(
    <React.StrictMode>
      <AppStatic></AppStatic>
    </React.StrictMode>
  );
} else if (valOverlayElem) {
  ReactDOM.createRoot(valOverlayElem).render(
    <React.StrictMode>
      <Overlay></Overlay>
    </React.StrictMode>
  );
} else {
  console.error("Val: could not mount Val element. Check your configuration.");
}
