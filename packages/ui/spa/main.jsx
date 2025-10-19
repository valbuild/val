import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Overlay from "./Overlay";
import { VAL_APP_ID, VAL_OVERLAY_ID } from "../src/constants";

const valAppElem = document.getElementById(VAL_APP_ID);
const valOverlayElem = document.getElementById(VAL_OVERLAY_ID);

let root = null;
if (valAppElem) {
  root = document.createElement("div");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App></App>
    </React.StrictMode>,
  );
  valAppElem.appendChild(root);
  window.dispatchEvent(new CustomEvent("val-ui-created"));
} else if (valOverlayElem) {
  root = document.createElement("div");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Overlay></Overlay>
    </React.StrictMode>,
  );
  valOverlayElem.appendChild(root);
  window.dispatchEvent(new CustomEvent("val-ui-created"));
} else {
  console.error("Val: could not mount Val element. Check your configuration.");
}

function appendValRoot(elem) {
  if (!root) {
    console.error(
      "Val: could not mount Val element. Check your configuration.",
    );
    return;
  }
  if (!elem) {
    console.error(`Val: could not find element with id ${VAL_APP_ID}`);
    return;
  }
  if (elem.childElementCount > 0) {
    console.error(
      "Val: could not append root element, mount point is not empty.",
    );
    return;
  }
  elem?.appendChild(root);
  window.dispatchEvent(new CustomEvent("val-ui-created"));
}

window.addEventListener("val-append-studio", () => {
  appendValRoot(document.getElementById(VAL_APP_ID));
});

window.addEventListener("val-append-overlay", () => {
  appendValRoot(document.getElementById(VAL_OVERLAY_ID));
});
