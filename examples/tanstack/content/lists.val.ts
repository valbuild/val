import { s, c, type t } from "../val.config";

/**
 * Lists of PRIMITIVES, which the compare view diffs by content.
 *
 * An array item's path is positional — `?p="0"`, `?p="1"` — so a reorder does not
 * move paths, it moves content between fixed paths. The compare view used to
 * render one row per touched index and read each row's "before" from the base
 * source at that index, which for a list is wrong twice over: inserting one item
 * shifted every later index, so one insertion read as a cascade of changes, and
 * each row's "before" named a different element than its "after".
 *
 * `ComparePatchSets` now diffs a primitive list as a whole, matching items by
 * value (`utils/listDiff.ts`), so a move is reported as a move and an insertion
 * as one line. Nothing else in this project has an `s.array` of primitives, and
 * the behaviour is only observable on one, so this fixture exists to be that.
 *
 * Each field is a different thing the diff has to get right:
 *
 * - `keywords` — the ordinary case, long enough to reorder meaningfully.
 * - `duplicates` — repeated values, where matching by content can double-count:
 *   three "draft"s before and two after must produce ONE removal, not three.
 * - `priorities` — numbers, to pin that this is not string-only.
 * - `flags` — booleans, the smallest possible value domain, where almost every
 *   item "matches" almost every other and the LCS is doing all the work.
 * - `empties` — starts empty, so adding the first item is covered; an item added
 *   and not yet typed into IS the empty string, which has to render as something.
 */
export const schema = s.object({
  keywords: s
    .array(s.string())
    .describe("Reorder these to see a move reported as a move"),
  duplicates: s
    .array(s.string())
    .describe("Repeated values, matched one-for-one"),
  priorities: s.array(s.number()),
  flags: s.array(s.boolean()),
  empties: s.array(s.string()).describe("Starts empty"),
});

export type Lists = t.inferSchema<typeof schema>;

export default c.define("/content/lists.val.ts", schema, {
  keywords: ["content", "editing", "preview", "publish", "validation"],
  duplicates: ["draft", "review", "draft", "published", "draft"],
  priorities: [1, 2, 3, 5, 8],
  flags: [true, false, true],
  empties: [],
});
