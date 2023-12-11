/* eslint-disable @typescript-eslint/no-explicit-any */
import jsxRuntime from "react/jsx-runtime";
import jsxRuntimeDev from "react/jsx-dev-runtime";
import React from "react";
import {
  vercelStegaSplit,
  vercelStegaDecode,
  VERCEL_STEGA_REGEX,
} from "@vercel/stega";

const isIntrinsicElement = (type: any) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const addValPathIfFound = (type: any, props: any) => {
  const valSources: any = [];
  if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "string" && value.match(VERCEL_STEGA_REGEX)) {
        const encodedBits = vercelStegaDecode(value);
        if (!encodedBits || typeof encodedBits !== "object") continue;
        if (
          "origin" in encodedBits &&
          "data" in encodedBits &&
          typeof encodedBits.data === "object" &&
          encodedBits.data &&
          "valPath" in encodedBits.data
        ) {
          const valPath = encodedBits?.data?.valPath;
          if (valPath) {
            valSources.push(valPath);
            props[key] = isIntrinsicElement(type)
              ? vercelStegaSplit(value).cleaned
              : value;
            props[`data-val-attr-${key.toLowerCase()}`] = valPath;
          }
        }
      }
    }

    if (valSources.length > 0) {
      props["data-val-path"] = valSources.join(",");
    }
  }
};

function WrapJsx<T>(jsx: T): T {
  if (typeof jsx !== "function") return jsx;

  return function (type: any, props: any, ...rest: any[]) {
    addValPathIfFound(type, props);
    return jsx.call(jsx, type, props, ...rest);
  } as any as T;
}

interface JsxRuntimeModule {
  jsx?(type: any, ...rest: any[]): unknown;
  jsxs?(type: any, ...rest: any[]): unknown;
  jsxDEV?(type: any, ...rest: any[]): unknown;
}

export function autoTagJSX() {
  const JsxPro: JsxRuntimeModule = jsxRuntime;
  const JsxDev: JsxRuntimeModule = jsxRuntimeDev;

  /**
   * createElement _may_ be called by jsx runtime as a fallback in certain cases,
   * so we need to wrap it regardless.
   *
   * The jsx exports depend on the `NODE_ENV` var to ensure the users' bundler doesn't
   * include both, so one of them will be set with `undefined` values.
   */
  React.createElement = WrapJsx(React.createElement);
  JsxDev.jsx && /*   */ (JsxDev.jsx = WrapJsx(JsxDev.jsx));
  JsxPro.jsx && /*   */ (JsxPro.jsx = WrapJsx(JsxPro.jsx));
  JsxDev.jsxs && /*  */ (JsxDev.jsxs = WrapJsx(JsxDev.jsxs));
  JsxPro.jsxs && /*  */ (JsxPro.jsxs = WrapJsx(JsxPro.jsxs));
  JsxDev.jsxDEV && /**/ (JsxDev.jsxDEV = WrapJsx(JsxDev.jsxDEV));
  JsxPro.jsxDEV && /**/ (JsxPro.jsxDEV = WrapJsx(JsxPro.jsxDEV));
}
