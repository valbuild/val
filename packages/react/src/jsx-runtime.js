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
      if (value && value.val && value.valSource) {
        valSources.push(value.valSource);
        if (typeof value.val === "string") {
          props[key] = value.val;
        } else {
          throw Error("TODO: handle non-string values");
        }
      }
    }
  }

  if (valSources.length > 0) {
    props["data-val-source"] = valSources.join(",");
  }
};

export function jsx(type, props, key) {
  // console.log("jsx", type, props, key);

  devalProps(type, props);

  return ReactJSXRuntime.jsx(type, props, key);
}

export function jsxs(type, props, key) {
  // console.log("jsxs", type, props, key);

  devalProps(type, props);

  return ReactJSXRuntime.jsxs(type, props, key);
}
