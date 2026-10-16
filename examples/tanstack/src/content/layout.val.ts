import { s, c, type t } from "../../val.config";

/**
 * `s.int()` and `s.number()`: what a number may be, and how it is edited.
 *
 * `.min()`, `.max()` and `.step()` are rules — the validator enforces them.
 * `.render({ as: "slider", min, max })` is layout: the field becomes a slider
 * with a box beside it for typing an exact value. A slider needs both ends, so
 * the render requires them, and it may only produce values the rules accept —
 * which is why `gap`'s slider stops at 48 while the rule allows 64.
 */
export const schema = s.object({
  columns: s
    .int()
    .min(1)
    .max(6)
    .describe("How many columns the grid uses, from 1 to 6"),
  gap: s
    .int()
    .min(0)
    .max(64)
    .step(4)
    .render({ as: "slider", min: 0, max: 48 })
    .describe("Space between the cards, in pixels"),
  opacity: s
    .int()
    .min(0)
    .max(100)
    .render({ as: "slider", min: 0, max: 100, step: 5 })
    .describe("How opaque the cards are, in percent"),
  rating: s
    .int()
    .min(1)
    .max(5)
    .render({ as: "slider", min: 1, max: 5 })
    .describe("Stars, from 1 to 5"),
  // `s.number()` takes the same render, and its steps may be decimals.
  lineHeight: s
    .number()
    .min(1)
    .max(2)
    .render({ as: "slider", min: 1, max: 2, step: 0.1 })
    .describe("Line height of the card text"),
});

export type Layout = t.inferSchema<typeof schema>;

export default c.define("/src/content/layout.val.ts", schema, {
  columns: 3,
  gap: 16,
  opacity: 80,
  rating: 4,
  lineHeight: 1.5,
});
