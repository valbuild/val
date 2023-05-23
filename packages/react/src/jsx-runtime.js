import { Internal } from "@valbuild/lib";
import * as ReactJSXRuntime from "react/jsx-runtime";
export * from "react/jsx-runtime";

const isIntrinsicElement = (type) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const devalProps = (type, props) => {
  const valSources = [];

  if (isIntrinsicElement(type)) {
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "object" && value !== null && "val" in value) {
        const valPath = Internal.getValPath(value);
        if (valPath) {
          valSources.push(valPath);
          if (typeof value.val === "string" || value.val === null) {
            props[key] = value.val;
          } else {
            throw Error("TODO: unhandled value type");
          }
        }
      }
    }
  }

  if (valSources.length > 0) {
    props["data-val-path"] = valSources.join(",");
  }
};

export function jsx(type, props, key) {
  // console.log("jsx", type, props, key);

  devalProps(type, props);

  return ReactJSXRuntime.jsx(type, props, key);
}

export function jsxs(type, props, key) {
  // console.log("jsxs", type, props, key);

  if (key === "key") {
    console.log("jsxDEV", type, props, key, self);
  }

  devalProps(type, props);

  return ReactJSXRuntime.jsxs(type, props, key);
}
