import { c, s } from "../val.config";

/**
 * `hidden()` and `readonly()`, which are easy to get half-right.
 *
 * Both are schema options with no runtime enforcement behind them: the server
 * will accept a patch for a readonly field, and the Studio is the only thing
 * that decides whether one can be made. So "it looks readonly" and "it IS
 * readonly" are different claims, and only the second one is worth anything —
 * a readonly string used to be dimmed and mouse-proof, and still perfectly
 * typeable once Tab had put the cursor in it.
 */
export default c.define(
  "/content/access.val.ts",
  s.object({
    /** The control case: an ordinary field beside the restricted ones. */
    editable: s.string(),
    /** Look, do not touch. */
    locked: s.string().readonly().describe("Set by the build, not by hand"),
    /** Not shown at all — not as a disabled row, not as an empty label. */
    secret: s.string().hidden(),
    lockedNumber: s.number().readonly(),
    lockedBoolean: s.boolean().readonly(),
    /** Restricted fields nested in a container, which is a separate path. */
    nested: s.object({
      locked: s.string().readonly(),
      secret: s.string().hidden(),
    }),
  }),
  {
    editable: "Type here",
    locked: "Do not edit",
    secret: "Not on screen",
    lockedNumber: 42,
    lockedBoolean: true,
    nested: {
      locked: "Also do not edit",
      secret: "Also not on screen",
    },
  },
);
