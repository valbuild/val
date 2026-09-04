---
"@valbuild/ui": patch
---

Studio: a calmer light mode.

Light mode was built on full white. Panels, the rail, the bars and every field
surface were `#ffffff`, and the canvas behind them sat 4% below that — so the
Studio filled the viewport with one bright sheet, and the floating layout had
almost no light to distinguish its layers with.

Every neutral surface now sits one step down the ramp: floating chrome and
fields at `#fcfcfc`, the canvas at `#f4f4f5`, raised and hover fills at a new
`#eeeef0`. Nothing large is pure white any more. The luminance gap between a
panel and the canvas roughly doubles, so panels read as floating rather than as
part of the page while the chrome gives off noticeably less light.

The panel hairline and muted text came down a nudge with the surfaces, because
on a softer background the old values read washed out rather than quiet. Every
foreground/background pair the chrome renders still meets WCAG AA, and with
more headroom than before — `contrast.test.ts` holds that.

Dark mode is unchanged.
