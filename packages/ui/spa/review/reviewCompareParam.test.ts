import {
  initVal,
  Internal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { PatchSets, type SerializedPatchSet } from "../utils/PatchSets";
import { pendingPatchSets } from "../utils/computeChangedSourcePaths";
import {
  applyReviewCompareParam,
  canOpenReviewCompare,
  hasChangeAt,
  parseReviewCompareParam,
  searchStringOf,
} from "./reviewCompareParam";

const { s } = initVal();

const GALLERY = "/content/media.val.ts" as ModuleFilePath;
const gallery = s.imageset({ accept: "image/*", dir: "/public/val" });
const A = "/public/val/a_12345.png";
const B = "/public/val/b_67890.png";

/** Patch sets for a gallery, built the way the Studio builds them. */
function gallerySets(
  patches: { patchId: string; patch: Parameters<PatchSets["insert"]>[2] }[],
): SerializedPatchSet {
  const patchSets = new PatchSets();
  for (const { patchId, patch } of patches) {
    patchSets.insert(
      GALLERY,
      gallery["executeSerialize"](),
      patch,
      patchId as PatchId,
      "2026-10-01T10:00:00Z",
      "alice",
    );
  }
  return patchSets.serialize();
}

/** The path the gallery's Compare link names: the entry, as the gallery spells it. */
function entryPath(ref: string): SourcePath {
  const path = Internal.createValPathOfItem(GALLERY, ref);
  if (path === undefined) throw Error(`No path for ${ref}`);
  return path;
}

describe("the ?compare param", () => {
  test("is absent: the dialog is closed", () => {
    expect(parseReviewCompareParam("")).toBeNull();
    expect(parseReviewCompareParam("?session=abc")).toBeNull();
  });

  test("is bare: the dialog opens on the first change", () => {
    expect(parseReviewCompareParam("?compare")).toEqual({ sourcePath: null });
    expect(parseReviewCompareParam("?compare=")).toEqual({ sourcePath: null });
  });

  test("names a path: the dialog opens on it", () => {
    const path = entryPath(A);
    const search = searchStringOf(
      applyReviewCompareParam(new URLSearchParams(), { sourcePath: path }),
    );
    expect(parseReviewCompareParam(search)).toEqual({ sourcePath: path });
  });

  test("is written bare when it names nothing, beside other params", () => {
    const params = new URLSearchParams("session=abc");
    applyReviewCompareParam(params, { sourcePath: null });
    expect(searchStringOf(params)).toBe("session=abc&compare");
    expect(parseReviewCompareParam(searchStringOf(params))).toEqual({
      sourcePath: null,
    });
  });

  /*
   * Hand-edited, truncated or from somewhere else: not a path the dialog could
   * look for. Closed, the same answer a path to no staged change gets, rather
   * than open onto some other change.
   */
  test("names something that is not a source path: the dialog stays closed", () => {
    expect(parseReviewCompareParam("?compare=hello")).toBeNull();
    expect(parseReviewCompareParam("?compare=%2Fno-module%2Fhere")).toBeNull();
    expect(
      parseReviewCompareParam(
        `?compare=${encodeURIComponent(`${GALLERY}?p=`)}`,
      ),
    ).toBeNull();
  });

  test("names a module with no path below it: the dialog opens on it", () => {
    expect(
      parseReviewCompareParam(`?compare=${encodeURIComponent(GALLERY)}`),
    ).toEqual({ sourcePath: GALLERY });
  });

  test("is cleared by a closed state", () => {
    const params = new URLSearchParams("compare&session=abc");
    applyReviewCompareParam(params, null);
    expect(searchStringOf(params)).toBe("session=abc");
  });
});

describe("canOpenReviewCompare", () => {
  const added = gallerySets([
    {
      patchId: "p1",
      patch: [
        {
          op: "add",
          path: [A],
          value: { width: 1, height: 1, mimeType: "image/png", alt: null },
        },
      ],
    },
  ]);

  test("opens on nothing when nothing is staged, link or no link", () => {
    expect(canOpenReviewCompare([], null)).toBe(false);
    expect(canOpenReviewCompare([], entryPath(A))).toBe(false);
  });

  test("opens bare whenever something is staged", () => {
    expect(canOpenReviewCompare(added, null)).toBe(true);
  });

  test("opens on a gallery entry that was added", () => {
    expect(canOpenReviewCompare(added, entryPath(A))).toBe(true);
  });

  test("opens on a gallery entry whose alt was edited", () => {
    const altEdited = gallerySets([
      {
        patchId: "p2",
        patch: [{ op: "replace", path: [A, "alt"], value: "A cat" }],
      },
    ]);
    expect(canOpenReviewCompare(altEdited, entryPath(A))).toBe(true);
  });

  test("does not open on an entry that is not in the staged set", () => {
    expect(canOpenReviewCompare(added, entryPath(B))).toBe(false);
  });

  /*
   * `a_12345.png` is a textual prefix of `a_12345.png.bak`; matching on that
   * would open the dialog on a sibling's change under a link to this one.
   */
  test("does not mistake a sibling whose key starts the same for the entry", () => {
    expect(canOpenReviewCompare(added, entryPath(`${A}.bak`))).toBe(false);
  });
});

/*
 * What the gallery's Compare link is drawn on. In http mode a shipped patch
 * stays in the chain until the deploy moves the base, and the review page
 * leaves it out, so a link on it would open onto nothing.
 */
describe("hasChangeAt, over what the review page lists", () => {
  const altEdited = gallerySets([
    {
      patchId: "shipped",
      patch: [{ op: "replace", path: [A, "alt"], value: "A cat" }],
    },
  ]);

  test("sees a change that is still pending", () => {
    expect(
      hasChangeAt(pendingPatchSets(altEdited, new Set()), entryPath(A)),
    ).toBe(true);
  });

  test("does not see one that has shipped", () => {
    expect(
      hasChangeAt(
        pendingPatchSets(altEdited, new Set(["shipped" as PatchId])),
        entryPath(A),
      ),
    ).toBe(false);
  });
});
