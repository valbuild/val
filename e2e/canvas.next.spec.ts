import { test } from "@playwright/test";
import { NEXT_APP_URL } from "./apps";
import { defineCanvasSuite } from "./canvasSuite";

/**
 * The canvas, against `examples/next`: the spec that keeps `@valbuild/next`'s
 * overlay and canvas bridge covered now that the fs-mode suite drives
 * TanStack. The same suite as `canvas.spec.ts`; see `canvasSuite.ts`.
 */
test.use({ baseURL: NEXT_APP_URL });

defineCanvasSuite();
