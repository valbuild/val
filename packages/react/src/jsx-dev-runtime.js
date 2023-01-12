import * as ReactJSXRuntimeDev from "react/jsx-dev-runtime";
export * from "react/jsx-dev-runtime";

const isIntrinsicElement = (type) => {
  // TODO: think this is not correct, but good enough for now?
  return typeof type === "string";
};

const devalProps = (type, props) => {
  const valIds = [];

  if (isIntrinsicElement(type)) {
    for (const [key, value] of Object.entries(props)) {
      if (value && value.val && value.valId) {
        valIds.push(value.valId);
        if (typeof value.val === "string") {
          props[key] = value.val;
        } else {
          throw Error("TODO: handle non-string values");
        }
      }
    }
  }

  if (valIds.length > 0) {
    props["data-val-ids"] = valIds.join(",");
  }
};

export function jsx(type, props, key) {
  // console.log("jsx", type, props, key);

  devalProps(type, props);

  return ReactJSXRuntimeDev.jsx(type, props, key);
}

export function jsxs(type, props, key) {
  // console.log("jsxs", type, props, key);

  devalProps(type, props);

  return ReactJSXRuntimeDev.jsxs(type, props, key);
}

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
