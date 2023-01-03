import * as ReactJSXRuntimeDev from "react/jsx-dev-runtime";

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  console.log("jsxDEV", type, props, key, isStaticChildren, source, self);

  for (const [key, value] of Object.entries(props)) {
    if (value.val && typeof value.val === "string" && value.id) {
      props[key] = value.val;
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
