import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const appElem = document.getElementById("val-app");
const valUIElem = document.getElementById("val-ui")
if (appElem) {
  ReactDOM.createRoot(appElem).render(
    <React.StrictMode>
      <App></App>
    </React.StrictMode>
  );
} else if (valUIElem) {
  const valOverlay = valUIElem?.shadowRoot?.getElementById('val-overlay');
  ReactDOM.createRoot(valOverlay).render(
    <React.StrictMode>
      <Test />
    </React.StrictMode>
  );
} else {
  console.error('Val: no root element found. Check you Val config')
}

function Test() {
  return <div className="text-red-700">
    <button onClick={() => {
      console.log("click");
    }}>Click</button>
  </div>
}