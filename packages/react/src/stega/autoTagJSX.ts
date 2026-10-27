import { Internal } from "@valbuild/core";
/* eslint-disable @typescript-eslint/no-explicit-any */
import jsxRuntime from "react/jsx-runtime";
import jsxRuntimeDev from "react/jsx-dev-runtime";
import React from "react";
import { vercelStegaSplit, VERCEL_STEGA_REGEX } from "@vercel/stega";
import { stegaDecodeStrings } from "./stegaDecodeStrings";
import { IS_AUTO_TAG_JSX_ENABLED, IS_RSC } from ".";

const isIntrinsicElement = (type: any) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const FRAGMENT = Symbol.for("react.fragment");

/**
 * The paths a fragment's text named, by the fragment element. A fragment has
 * no DOM element to carry `data-val-path`, so its text is cleaned and its
 * paths go to the element it is a child of: `<li>{a} <>— {b}</></li>` tags
 * the `<li>` with both. Without this its text kept its edit tag, on the page.
 */
const fragmentPaths = new WeakMap<object, string[]>();

/** The paths of the fragments among `children`, when it holds any. */
function pathsOfFragmentChildren(children: unknown): string[] {
  const found: string[] = [];
  // `.flat`: a list of keyed fragments from `.map()` is an array among them.
  for (const child of [children].flat(Infinity)) {
    if (typeof child === "object" && child !== null) {
      const paths = fragmentPaths.get(child);
      if (paths) {
        found.push(...paths);
      }
    }
  }
  return found;
}

/**
 * Takes the edit tags out of a fragment's text, and returns the paths they
 * named -- its own and its fragment children's -- for its parent to carry.
 */
function cleanFragment(props: any): string[] {
  if (!props || typeof props !== "object") {
    return [];
  }
  const paths = pathsOfFragmentChildren(props.children);
  const clean = (value: unknown): unknown => {
    if (typeof value === "string" && value.match(VERCEL_STEGA_REGEX)) {
      const found = stegaDecodeStrings(value);
      if (found) {
        paths.push(...found);
        return vercelStegaSplit(value).cleaned;
      }
    }
    return value;
  };
  if (Array.isArray(props.children)) {
    if (!Object.isFrozen(props.children)) {
      props.children.forEach((child: unknown, index: number) => {
        props.children[index] = clean(child);
      });
    }
  } else if (!Object.isFrozen(props)) {
    props.children = clean(props.children);
  }
  return paths;
}

const addValPathIfFound = (type: any, props: any): string[] | undefined => {
  // TODO: increases performance. Unsure about the implications right now - seems to work. Remember to look at RSC and client (and pages/?).
  if (!IS_AUTO_TAG_JSX_ENABLED()) {
    return;
  }

  const valSources = new Set<string>();

  // A fragment cannot carry attributes: what it held goes to its parent.
  if (type === FRAGMENT) {
    return cleanFragment(props);
  }
  function updateValSources(
    key: string | number,
    value: string,
    props: Record<string, unknown>,
    container: Record<string, unknown> | Array<unknown>,
  ) {
    if (!key) {
      return;
    }
    // Prevent prototype pollution
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      Internal.log.error(
        'Could not auto tag. Reason: key is "__proto__" or "constructor" or "prototype".',
      );
      return;
    }
    const valPaths = stegaDecodeStrings(value);
    if (valPaths) {
      // Found val path - this is a stega encoded string
      // The logic below is as follows:
      //   if this is an intrinsic element (a, div, etc.), add data attrs will be on the DOM element
      //   always add to sources (intrinsic or not)
      //   if this is not an intrinsic element, we pass the stega encoded value downwards until we hit an intrinsic element
      for (const valPath of valPaths) {
        valSources.add(valPath);
      }

      if (isIntrinsicElement(type) && !Object.isFrozen(container)) {
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
          Internal.log.error(
            "Could not auto tag. Reason: unexpected types found while cleaning and / or adding val path data props.",
          );
        }
      } else {
        if (key === "href") {
          // This is a hack to make sure href values in Next Link components are cleaned (seems to be a React Server Component issue?)
          const cleanValue = vercelStegaSplit(value).cleaned;
          if (typeof key === "string" && !Array.isArray(container)) {
            container[key] = cleanValue;
            for (const valPath of valPaths) {
              valSources.add(valPath);
            }
          }
        }
      }
    }
  }
  if (props && typeof props === "object") {
    if (isIntrinsicElement(type)) {
      for (const path of pathsOfFragmentChildren(props.children)) {
        valSources.add(path);
      }
    }
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
                value as Record<string, unknown>,
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
      if (IS_RSC()) {
        props["data-val-rsc"] = "true";
      }
    }
  }
};

function WrapJsx<T>(jsx: T): T {
  if (typeof jsx !== "function") return jsx;

  return function (type: any, props: any, ...rest: any[]) {
    const fragmentPathsFound = addValPathIfFound(type, props);
    const element = jsx.call(jsx, type, props, ...rest);
    if (
      fragmentPathsFound &&
      fragmentPathsFound.length > 0 &&
      typeof element === "object" &&
      element !== null
    ) {
      fragmentPaths.set(element, fragmentPathsFound);
    }
    return element;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxDev.jsx && /*   */ (JsxDev.jsx = WrapJsx(JsxDev.jsx));
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxPro.jsx && /*   */ (JsxPro.jsx = WrapJsx(JsxPro.jsx));
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxDev.jsxs && /*  */ (JsxDev.jsxs = WrapJsx(JsxDev.jsxs));
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxPro.jsxs && /*  */ (JsxPro.jsxs = WrapJsx(JsxPro.jsxs));
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxDev.jsxDEV && /**/ (JsxDev.jsxDEV = WrapJsx(JsxDev.jsxDEV));
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  JsxPro.jsxDEV && /**/ (JsxPro.jsxDEV = WrapJsx(JsxPro.jsxDEV));
}
