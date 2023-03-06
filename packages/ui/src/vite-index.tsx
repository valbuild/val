export * from "./exports";

import styleCss from "./index.css?inline";

export function Style(): JSX.Element {
  return <style>{styleCss}</style>;
}
