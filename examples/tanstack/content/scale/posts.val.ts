import { s, c } from "../../val.config";
import imagesVal from "./images.val";

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

/**
 * A `.jsonValues()` record of `VAL_E2E_SCALE` posts, each picking an image
 * from the library. A record rather than a router: a router in this app has
 * to be named after a route file, and this fixture has no page.
 */
export default c.define(
  "/content/scale/posts.val.ts",
  s
    .record(
      s
        .object({
          title: s.string(),
          slug: s.string(),
          body: s.richtext({ bold: true }),
          image: s.image(imagesVal),
          tags: s.array(s.string()),
        })
        .preview(({ val }) => ({
          title: val.title,
          subtitle: val.slug,
          image: val.image,
        })),
    )
    .jsonValues(),
  Object.fromEntries(
    Array.from({ length: SCALE }, (_, i) => i).map((i) => [
      `post-${i}`,
      c.json(() =>
        Promise.resolve({
          default: {
            title: `Post number ${i}`,
            slug: `post-${i}`,
            body: [
              {
                tag: "p" as const,
                children: [
                  `The first paragraph of post ${i}, long enough to be a paragraph. `,
                  {
                    tag: "span" as const,
                    styles: ["bold" as const],
                    children: ["Some bold words"],
                  },
                ],
              },
              {
                tag: "p" as const,
                children: [`The second paragraph of post ${i}.`],
              },
            ],
            image: { path: `/public/val/scale/images/image-${i}.png` },
            tags: ["news", i % 2 === 0 ? "even" : "odd", `group-${i % 10}`],
          },
        }),
      ),
    ]),
  ),
);
