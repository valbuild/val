/* eslint-disable @typescript-eslint/no-explicit-any */
import jsxRuntime from "react/jsx-runtime";
import jsxRuntimeDev from "react/jsx-dev-runtime";
import React from "react";
import { vercelStegaSplit, VERCEL_STEGA_REGEX } from "@vercel/stega";
import { stegaDecodeString } from "./stegaDecodeString";
// import { IS_AUTO_TAG_JSX_ENABLED } from ".";

const isIntrinsicElement = (type: any) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const addValPathIfFound = (type: any, props: any) => {
  // TODO: increases performance. Unsure about the implications right now - seems to work. Remember to look at RSC and client (and pages/?).
  // if (!IS_AUTO_TAG_JSX_ENABLED()) {
  //   return;
  // }

  const valSources = new Set<string>();

  // skip auto-tagging fragments since we can't add attributes to them
  if (type === Symbol.for("react.fragment")) {
    return;
  }
  function updateValSources(
    key: string | number,
    value: string,
    props: Record<string, unknown>,
    container: Record<string, unknown> | Array<unknown>
  ) {
    if (!key) {
      return;
    }
    // Prevent prototype pollution
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      console.error(
        'Val: Could not auto tag. Reason: key is "__proto__" or "constructor" or "prototype".'
      );
      return;
    }
    const valPath = stegaDecodeString(value);
    if (valPath) {
      // Found val path - this is a stega encoded string
      // The logic below is as follows:
      //   if this is an intrinsic element (a, div, etc.), add data attrs will be on the DOM element
      //   always add to sources (intrinsic or not)
      //   if this is not an intrinsic element, we pass the stega encoded value downwards until we hit an intrinsic element
      valSources.add(valPath);
      if (isIntrinsicElement(type)) {
        // clean values before adding them to the props
        // we cannot do this
        const cleanValue = vercelStegaSplit(value).cleaned;
        // we do Object.entries earlier over props so props that are arrays have string keys:
        const numberOfKey = Number(key);
        if (Array.isArray(container) && numberOfKey > -1) {
          container[numberOfKey] = cleanValue;
        } else if (typeof key === "string" && !Array.isArray(container)) {
          container[key] = cleanValue;
        } else {
          console.error(
            "Val: Could not auto tag. Reason: unexpected types found while cleaning and / or adding val path data props."
          );
        }
      }
    }
  }
  if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "string" && value.match(VERCEL_STEGA_REGEX)) {
        updateValSources(key, value, props, props);
      } else if (typeof value === "object" && value !== null) {
        if (key === "style") {
          for (const [styleKey, styleValue] of Object.entries(value)) {
            if (
              typeof styleValue === "string" &&
              styleValue.match(VERCEL_STEGA_REGEX)
            ) {
              updateValSources(
                styleKey,
                styleValue,
                props,
                value as Record<string, unknown>
              );
            }
          }
        } else if (value instanceof Array) {
          for (const [index, item] of Object.entries(value)) {
            if (typeof item === "string" && item.match(VERCEL_STEGA_REGEX)) {
              updateValSources(index, item, props, value);
            }
          }
        }
      }
    }
    if (valSources.size > 0 && !props["data-val-path"]) {
      props["data-val-path"] = Array.from(valSources).join(",");
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
