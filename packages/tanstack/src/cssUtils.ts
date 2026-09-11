import { Internal } from "@valbuild/core";
import { VERSION as UIVersion } from "@valbuild/ui";

// All DOM element that are outside the Shadow DOM should use this class name prefix
export const valPrefixedClass =
  "val-prefix-" +
  Internal.getSHA256Hash(new TextEncoder().encode(UIVersion || "")).slice(
    0,
    8,
  ) +
  "-";
export const prefixStyles = (styles: Record<string, string>) => {
  return Object.entries(styles)
    .map(([key, value]) => {
      return `.${valPrefixedClass}${key.replace(/\//g, "\\/")} { ${value} }`;
    })
    .join("\n");
};
export const cn = (className: string[]) =>
  className.map((c) => `${valPrefixedClass}${c}`).join(" ");
