import { defineCanvasSuite } from "./canvasSuite";

/**
 * The canvas, against `examples/tanstack` -- the `chromium` project's default
 * app. The suite and the why are in `canvasSuite.ts`; `canvas.next.spec.ts`
 * runs the same suite against Next.
 */
defineCanvasSuite();
