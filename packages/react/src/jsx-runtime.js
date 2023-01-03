import * as ReactJSXRuntime from "react/jsx-runtime";

export function jsx(type, props, key) {
  return ReactJSXRuntime.jsx(type, props, key);
}

export function jsxs(type, props, key) {
  return ReactJSXRuntime.jsxs(type, props, key);
}
