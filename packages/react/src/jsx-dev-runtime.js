import * as ReactJSXRuntimeDev from "react/jsx-dev-runtime";

const isIntrinsicElement = (type) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  console.log("jsxDEV", type, props, key, isStaticChildren, source, self);

  if (isIntrinsicElement(type)) {
    for (const [key, value] of Object.entries(props)) {
      if (value.val && value.id) {
        if (typeof value.val === "string") {
          props[key] = value.val;
        } else {
          throw Error("TODO: handle non-string values");
        }
      }
    }
  }

  return ReactJSXRuntimeDev.jsxDEV(
    type,
    props,
    key,
    isStaticChildren,
    source,
    self
  );
}
