import { getValPath } from "@valbuild/lib";
import * as ReactJSXRuntimeDev from "react/jsx-dev-runtime";
export * from "react/jsx-dev-runtime";

const isIntrinsicElement = (type) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const devalProps = (type, props) => {
  const valSources = [];

  if (isIntrinsicElement(type)) {
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "object" && value !== null && "val" in value) {
        const valPath = getValPath(value);
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

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  // console.log("jsxDEV", type, props, key, isStaticChildren, source, self);

  devalProps(type, props);

  return ReactJSXRuntimeDev.jsxDEV(
    type,
    props,
    key,
    isStaticChildren,
    source,
    self
  );
}
