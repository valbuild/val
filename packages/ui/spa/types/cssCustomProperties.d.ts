/**
 * Let a `style` object carry — and be read for — CSS custom properties.
 *
 * `@types/react` removed the index signature from `CSSProperties` on purpose,
 * so that a typo in `backgroundColor` is an error, and says in the comment
 * where it did so that adding one back is done by type assertion or module
 * augmentation. This is the augmentation, narrowed to `--*` so the closed
 * typing of every real CSS property is untouched.
 *
 * The Studio's theme is a set of custom properties on the element that carries
 * `data-mode` (see `ValThemeProvider`). WRITING them needs nothing: the object
 * comes from `themeCustomProperties` as a `Record<string, string>`, which is
 * assignable as it is. READING one back is what fails —
 * `themeStyle["--radius"]` is `TS7053` — and the tests that pin the theme down
 * do exactly that. Asserting there would mean a test that cannot see the type
 * error it exists to catch.
 */
import type {} from "react";

declare module "react" {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
