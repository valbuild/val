import { s, c } from "../../val.config";

/**
 * Phase 10 of `docs/plans/one-content-model.md`: the Studio at size, in a
 * real browser (`e2e/tanstack/scale.spec.ts`). `VAL_E2E_SCALE` entries, which
 * `vite.config.ts` inlines for the server and the browser alike; registered
 * only when it is set (`val.modules.ts`). The same shapes as the scenario
 * world's generator (`scenarios/measure/scaleWork.ts`). Generated when the
 * module is evaluated, so nothing of size is checked in -- and so these are
 * never published: a publish rewrites the `.val.ts` text, and this text is a
 * loop. (A `.val.ts` may import only `.val` files and `val.config`, so each
 * of these reads the size itself.)
 */
const SCALE = Number(process.env.VAL_E2E_SCALE || 0);
const IMAGE_DIR = "/public/val/scale/images";

/** An image library of `VAL_E2E_SCALE` entries. */
export default c.define(
  "/content/scale/images.val.ts",
  s.imagedir(IMAGE_DIR, { alt: s.string().nullable() }),
  Object.fromEntries(
    Array.from({ length: SCALE }, (_, i) => i).map((i) => [
      `/public/val/scale/images/image-${i}.png`,
      { width: 1200, height: 800, mimeType: "image/png", alt: `Image ${i}` },
    ]),
  ),
);
