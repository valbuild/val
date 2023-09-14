export * from "@valbuild/core";

export { ValProvider } from "@valbuild/react";
export { ValRichText } from "@valbuild/react";

export { useVal } from "@valbuild/react/stega";
export { type ValEncodedString } from "@valbuild/react/stega";
export { fetchVal } from "./fetchVal";

// Auto-tag JSX with Val paths:
import { autoTagJSX } from "@valbuild/react/stega";

// NOTE! Side effects:
autoTagJSX();
