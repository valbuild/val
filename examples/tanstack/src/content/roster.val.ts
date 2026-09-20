import { s, c } from "../../val.config";

/**
 * A module that the nav does not list, reached from the one page it belongs to.
 *
 * `.hidden()` on a MODULE's root schema means exactly one thing: the Explorer
 * does not list it. A module has no parent to be hidden from, so it can mean
 * nothing else — in particular it does NOT mean the module cannot be opened.
 * Follow the `s.view()` row on `access.val.ts` and this renders in full, with
 * its own breadcrumb and its own address.
 *
 * That pairing is what the two features are for together. A record like this is
 * usually a `keyOf` target that a dozen modules point into, so it has to be its
 * own module — and it clutters the nav for every editor who never edits it
 * directly. Hiding it and putting one view where it belongs is how it stays
 * reachable without being in everybody's way.
 */
export default c.define(
  "/src/content/roster.val.ts",
  s
    .record(
      s.object({
        name: s.string(),
        role: s.string(),
      }),
    )
    .hidden()
    .describe("Who is on the team"),
  {
    ada: { name: "Ada", role: "Engineering" },
    grace: { name: "Grace", role: "Engineering" },
  },
);
