import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { boundUnstageClosure } from "./ValServer";

/**
 * The client computes the forward closure of a discard; this server bounds it.
 *
 * It has to. `unstagePatchIds` was forwarded verbatim, and the content API
 * removes those memberships from EVERY group with no ownership check — so any
 * logged-in editor could strip arbitrary patches out of any other author's
 * group by attaching them to a delete of one of their own throwaway patches.
 * Their next publish then silently ships less, which is exactly the outcome the
 * 403 on `/patch-groups` exists to prevent, reached by a different door.
 *
 * Neither server can compute the true closure — that needs the schema — but the
 * two bounds below hold whatever the schema says: a patch can only be
 * invalidated by a delete it was written AFTER, and only inside the same
 * module, since a patch set never spans two.
 */

const A = "/a.val.ts" as ModuleFilePath;
const B = "/b.val.ts" as ModuleFilePath;
const id = (n: string) => n as PatchId;

/** A chain in chain order: `p1` and `p3` in module A, `p2` and `p4` in B. */
const CHAIN = [
  { patchId: id("p1"), path: A },
  { patchId: id("p2"), path: B },
  { patchId: id("p3"), path: A },
  { patchId: id("p4"), path: B },
];

test("keeps a later patch in the same module", () => {
  // `p3` was written against a view that had `p1`, so deleting `p1` can have
  // moved the paths it chose. This is the case the field exists for.
  expect(boundUnstageClosure(CHAIN, [id("p1")], [id("p3")])).toEqual([
    id("p3"),
  ]);
});

test("drops a patch in another module", () => {
  // A patch set never spans two modules, so nothing in B was in `p1`'s set.
  expect(boundUnstageClosure(CHAIN, [id("p1")], [id("p2"), id("p4")])).toEqual(
    [],
  );
});

test("drops a patch EARLIER in the chain", () => {
  // `p1` was written before `p3` existed, so deleting `p3` cannot have moved
  // anything it referred to.
  expect(boundUnstageClosure(CHAIN, [id("p3")], [id("p1")])).toEqual([]);
});

test("drops an id that is not in the chain at all", () => {
  expect(boundUnstageClosure(CHAIN, [id("p1")], [id("nope")])).toEqual([]);
});

test("drops an id that is itself being deleted", () => {
  // Its membership goes with it by cascade. Naming it again is how an
  // over-broad list hides among legitimate entries.
  expect(boundUnstageClosure(CHAIN, [id("p1"), id("p3")], [id("p3")])).toEqual(
    [],
  );
});

test("keeps the legitimate part of an over-broad list", () => {
  /*
   * The attack, and the reason this drops rather than refuses: an editor
   * deletes their own `p1` and attaches somebody else's `p2` and `p4`. The
   * delete is still correct and still happens; only the extras go.
   */
  expect(
    boundUnstageClosure(CHAIN, [id("p1")], [id("p2"), id("p3"), id("p4")]),
  ).toEqual([id("p3")]);
});

test("nothing requested is nothing forwarded", () => {
  expect(boundUnstageClosure(CHAIN, [id("p1")], [])).toEqual([]);
});

test("a delete that is not in the chain bounds nothing", () => {
  // Already gone, or never ours. It cannot justify stripping anything.
  expect(boundUnstageClosure(CHAIN, [id("gone")], [id("p3")])).toEqual([]);
});
