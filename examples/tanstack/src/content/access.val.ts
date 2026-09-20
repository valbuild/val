import { s, c } from "../../val.config";

/**
 * `.readonly()` and `.hidden()`, which are easy to get half-right.
 *
 * Both are schema options with no runtime enforcement behind them: the server
 * will accept a patch for a readonly field, and the Studio is the only thing
 * deciding whether one can be made. So "it looks readonly" and "it IS readonly"
 * are different claims — use them to keep an editor out of a field the build
 * owns, not as a permission system.
 */
export default c.define(
  "/src/content/access.val.ts",
  s.object({
    /** The control case: an ordinary field beside the restricted ones. */
    editable: s.string().describe("An ordinary field, for comparison"),
    /** Look, do not touch. */
    buildId: s.string().readonly().describe("Set by the build, not by hand"),
    /** Not shown at all — not as a disabled row, not as an empty label. */
    internalNote: s.string().hidden(),
    /** Restricted fields nested in a container, which is a separate path. */
    deploy: s.object({
      commit: s.string().readonly(),
      token: s.string().hidden(),
    }),
  }),
  {
    editable: "Type here",
    buildId: "tanstack-example",
    internalNote: "Not on screen",
    deploy: {
      commit: "0000000",
      token: "also not on screen",
    },
  },
);
