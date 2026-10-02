import { Internal, ModuleFilePath } from "@valbuild/core";
import {
  MediaRenameTarget,
  buildMediaRenamePatches,
  parseMediaPath,
  planMediaRename,
  splitEditableFilename,
} from "./renameMediaFile";

const SHA = "bfbd0a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f";
const BYTES = { dataUrl: "data:image/png;base64,AAAA", sha256: SHA };
const METADATA = { width: 8, height: 8, mimeType: "image/png" };
const GALLERY = "/content/gallery.val.ts" as ModuleFilePath;
const PAGE = "/content/page.val.ts" as ModuleFilePath;

function remoteRef(filePath: `public/${string}`) {
  return Internal.remote.createRemoteRef("https://remote.val.build", {
    publicProjectId: "proj",
    coreVersion: "0.1.0",
    bucket: "b1",
    validationHash: "vh12",
    fileHash: SHA.slice(0, 12),
    filePath,
  });
}

function sourcePath(moduleFilePath: ModuleFilePath, ...segments: string[]) {
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath(segments),
  );
}

function plan(target: MediaRenameTarget, filePatchIds = new Map()) {
  const res = planMediaRename(target, filePatchIds);
  if (res.status !== "ok") throw new Error(res.message);
  return res;
}

function build(
  target: MediaRenameTarget,
  newBase: string,
  filePatchIds = new Map<string, string>(),
) {
  const p = plan(target, filePatchIds);
  const res = buildMediaRenamePatches({
    target,
    plan: p,
    newBase,
    bytes: new Map(p.fetches.map((fetch) => [fetch.path, BYTES])),
    metadata: METADATA,
  });
  if (res.status !== "ok") throw new Error(JSON.stringify(res));
  return { plan: p, patches: res.patches };
}

describe("parseMediaPath", () => {
  test("refuses what is neither local nor remote", () => {
    expect(parseMediaPath("/images/x.png")).toBeNull();
    expect(parseMediaPath("/api/val/external/x/f/abc/p/public/a.png")).toBe(
      null,
    );
    expect(parseMediaPath("/public/val/")).toBeNull();
  });
});

describe("local gallery entry", () => {
  const key = "/public/val/hero_bfbd0.png";
  const target: MediaRenameTarget = {
    kind: "gallery-entry",
    moduleFilePath: GALLERY,
    patchPath: [],
    key,
    existingKeys: [key],
    referrers: [
      {
        sourcePath: sourcePath(PAGE, "hero"),
        path: key,
        hasPatchId: false,
      },
      {
        sourcePath: sourcePath(PAGE, "body", "0", "children", "1", "src"),
        path: key,
        hasPatchId: false,
      },
    ],
  };

  test("fetches the published bytes, moves the entry and deletes the old file", () => {
    const { plan, patches } = build(target, "Team Photo");
    expect(plan.fetches).toEqual([{ path: key, url: "/val/hero_bfbd0.png" }]);
    expect(patches.newPath).toBe("/public/val/teamphoto_bfbd0.png");
    expect(patches.primary).toEqual({
      moduleFilePath: GALLERY,
      patch: [
        { op: "move", from: [key], path: [patches.newPath] },
        {
          op: "file",
          path: [patches.newPath],
          filePath: patches.newPath,
          value: BYTES.dataUrl,
          remote: false,
          metadata: METADATA,
        },
        {
          op: "file",
          path: [key],
          filePath: key,
          value: null,
          remote: false,
        },
      ],
    });
  });

  test("rewrites every referrer, rich text included, in one patch per module", () => {
    const { patches } = build(target, "team-photo");
    expect(patches.referrers).toEqual([
      {
        moduleFilePath: PAGE,
        patch: [
          {
            op: "replace",
            path: ["hero", "path"],
            value: "/public/val/team-photo_bfbd0.png",
          },
          {
            op: "replace",
            path: ["body", "0", "children", "1", "src", "path"],
            value: "/public/val/team-photo_bfbd0.png",
          },
        ],
      },
    ]);
  });

  test("a draft is fetched from the patch it is in", () => {
    const { plan } = build(target, "x", new Map([[key, "patch-1"]]));
    expect(plan.fetches.map((fetch) => fetch.url)).toEqual([
      "/api/val/files/public/val/hero_bfbd0.png?patch_id=patch-1",
    ]);
  });

  test("a referrer that uploaded the draft itself gets its own file op", () => {
    const withDraftReferrer: MediaRenameTarget = {
      ...target,
      referrers: [{ ...target.referrers[0], hasPatchId: true }],
    };
    const { patches } = build(withDraftReferrer, "team");
    expect(patches.referrers[0].patch).toContainEqual(
      expect.objectContaining({
        op: "file",
        path: ["hero"],
        filePath: "/public/val/team_bfbd0.png",
        value: BYTES.dataUrl,
      }),
    );
  });

  test("refuses a name already taken in the gallery", () => {
    const taken = "/public/val/team_bfbd0.png";
    const p = plan(target);
    expect(
      buildMediaRenamePatches({
        target: { ...target, existingKeys: [key, taken] },
        plan: p,
        newBase: "team",
        bytes: new Map(p.fetches.map((fetch) => [fetch.path, BYTES])),
        metadata: METADATA,
      }),
    ).toEqual({
      status: "error",
      message: "The gallery already has a file called team_bfbd0.png.",
    });
  });

  test("the same name is not a rename", () => {
    const p = plan(target);
    expect(
      buildMediaRenamePatches({
        target,
        plan: p,
        newBase: "Hero",
        bytes: new Map(p.fetches.map((fetch) => [fetch.path, BYTES])),
        metadata: METADATA,
      }),
    ).toEqual({ status: "unchanged" });
  });

  test("a name with nothing usable is refused", () => {
    const p = plan(target);
    expect(
      buildMediaRenamePatches({
        target,
        plan: p,
        newBase: "æøå",
        bytes: new Map(p.fetches.map((fetch) => [fetch.path, BYTES])),
        metadata: METADATA,
      }).status,
    ).toBe("error");
  });
});

describe("remote gallery entry", () => {
  const key = remoteRef("public/val/hero_bfbd0.png");
  const target: MediaRenameTarget = {
    kind: "gallery-entry",
    moduleFilePath: GALLERY,
    patchPath: [],
    key,
    existingKeys: [key],
    referrers: [
      { sourcePath: sourcePath(PAGE, "hero"), path: key, hasPatchId: false },
    ],
  };

  test("published: a new ref and nothing uploaded or deleted", () => {
    const { plan, patches } = build(target, "team");
    expect(plan.fetches).toEqual([]);
    const newRef = remoteRef("public/val/team_bfbd0.png");
    expect(patches.newPath).toBe(newRef);
    expect(patches.primary.patch).toEqual([
      { op: "move", from: [key], path: [newRef] },
    ]);
    expect(patches.referrers[0].patch).toEqual([
      { op: "replace", path: ["hero", "path"], value: newRef },
    ]);
  });

  test("the new ref keeps hash, bucket and validation hash", () => {
    const { patches } = build(target, "team");
    const before = Internal.remote.splitRemoteRef(key);
    const after = Internal.remote.splitRemoteRef(patches.newPath);
    if (before.status !== "success" || after.status !== "success") {
      throw new Error("not a ref");
    }
    expect({ ...after, filePath: before.filePath }).toEqual(before);
    expect(after.filePath).toBe("public/val/team_bfbd0.png");
  });

  test("draft: the bytes are uploaded again under the new ref, never deleted", () => {
    const { plan, patches } = build(target, "team", new Map([[key, "p1"]]));
    expect(plan.fetches.map((fetch) => fetch.url)).toEqual([
      expect.stringContaining("&remote=true&ref="),
    ]);
    const newRef = remoteRef("public/val/team_bfbd0.png");
    expect(patches.primary.patch).toEqual([
      { op: "move", from: [key], path: [newRef] },
      {
        op: "file",
        path: [newRef],
        filePath: newRef,
        value: BYTES.dataUrl,
        remote: true,
        metadata: METADATA,
      },
    ]);
  });
});

describe("remote bytes behind a local gallery key", () => {
  // What an upload through an `s.image(remoteGallery)` FIELD produces.
  const key = "/public/val/hero_bfbd0.png";
  const ref = remoteRef("public/val/hero_bfbd0.png");
  const target: MediaRenameTarget = {
    kind: "gallery-entry",
    moduleFilePath: GALLERY,
    patchPath: [],
    key,
    existingKeys: [key],
    referrers: [
      { sourcePath: sourcePath(PAGE, "hero"), path: ref, hasPatchId: false },
    ],
  };

  test("is renamed as the remote file it is", () => {
    const { plan, patches } = build(target, "team");
    expect(plan.fetches).toEqual([]);
    expect(patches.newPath).toBe("/public/val/team_bfbd0.png");
    expect(patches.primary.patch).toEqual([
      { op: "move", from: [key], path: ["/public/val/team_bfbd0.png"] },
    ]);
    expect(patches.referrers[0].patch).toEqual([
      {
        op: "replace",
        path: ["hero", "path"],
        value: remoteRef("public/val/team_bfbd0.png"),
      },
    ]);
  });
});

describe("remote bytes behind a local key, with several refs", () => {
  const key = "/public/val/hero_bfbd0.png";
  const published = remoteRef("public/val/hero_bfbd0.png");
  // The same file under a second ref: uploaded after the validation hash moved.
  const draft = Internal.remote.createRemoteRef("https://remote.val.build", {
    publicProjectId: "proj",
    coreVersion: "0.2.0",
    bucket: "b1",
    validationHash: "vh34",
    fileHash: SHA.slice(0, 12),
    filePath: "public/val/hero_bfbd0.png",
  });
  const target: MediaRenameTarget = {
    kind: "gallery-entry",
    moduleFilePath: GALLERY,
    patchPath: [],
    key,
    existingKeys: [key],
    referrers: [
      // Published first: the order modules are walked in must not matter.
      { sourcePath: sourcePath(PAGE, "a"), path: published, hasPatchId: false },
      { sourcePath: sourcePath(PAGE, "b"), path: draft, hasPatchId: true },
    ],
  };

  test("each draft ref is moved under its own new ref", () => {
    const { plan, patches } = build(target, "team", new Map([[draft, "p9"]]));
    expect(plan.fetches.map((fetch) => fetch.path)).toEqual([draft]);
    const newDraft = Internal.remote.createRemoteRef(
      "https://remote.val.build",
      {
        publicProjectId: "proj",
        coreVersion: "0.2.0",
        bucket: "b1",
        validationHash: "vh34",
        fileHash: SHA.slice(0, 12),
        filePath: "public/val/team_bfbd0.png",
      },
    );
    // The gallery carries no bytes: they live behind the refs.
    expect(patches.primary.patch).toEqual([
      { op: "move", from: [key], path: ["/public/val/team_bfbd0.png"] },
    ]);
    expect(patches.referrers[0].patch).toEqual([
      {
        op: "replace",
        path: ["a", "path"],
        value: remoteRef("public/val/team_bfbd0.png"),
      },
      { op: "replace", path: ["b", "path"], value: newDraft },
      {
        op: "file",
        path: ["b"],
        filePath: newDraft,
        value: BYTES.dataUrl,
        remote: true,
        metadata: METADATA,
      },
    ]);
  });

  test("refs to different files cannot share one name", () => {
    const other = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "proj",
      coreVersion: "0.1.0",
      bucket: "b1",
      validationHash: "vh12",
      fileHash: "ffffff000000",
      filePath: "public/val/hero_bfbd0.png",
    });
    expect(
      planMediaRename(
        {
          ...target,
          referrers: [
            ...target.referrers,
            {
              sourcePath: sourcePath(PAGE, "c"),
              path: other,
              hasPatchId: false,
            },
          ],
        },
        new Map(),
      ).status,
    ).toBe("error");
  });

  test("refuses when a rewritten ref would resolve to another entry", () => {
    // The gallery already has the FULL ref the rename would produce as a key,
    // and a field resolves an exact key before the path inside its ref.
    const taken = remoteRef("public/val/team_bfbd0.png");
    const withTaken: MediaRenameTarget = {
      ...target,
      existingKeys: [key, taken],
    };
    const p = plan(withTaken);
    const res = buildMediaRenamePatches({
      target: withTaken,
      plan: p,
      newBase: "team",
      bytes: new Map(),
      metadata: METADATA,
    });
    expect(res.status).toBe("error");
  });
});

describe("standalone field", () => {
  test("local: re-uploads under the new path and deletes the old", () => {
    const path = "/public/val/doc_bfbd0.pdf";
    const { patches } = build(
      {
        kind: "field",
        moduleFilePath: PAGE,
        patchPath: ["attachment"],
        path,
      },
      "Annual Report",
    );
    expect(patches.primary.patch).toEqual([
      {
        op: "replace",
        path: ["attachment", "path"],
        value: "/public/val/annualreport_bfbd0.pdf",
      },
      {
        op: "file",
        path: ["attachment"],
        filePath: "/public/val/annualreport_bfbd0.pdf",
        value: BYTES.dataUrl,
        remote: false,
        metadata: METADATA,
      },
      {
        op: "file",
        path: ["attachment"],
        filePath: path,
        value: null,
        remote: false,
      },
    ]);
  });

  test("remote, published: only the ref changes", () => {
    const path = remoteRef("public/val/doc_bfbd0.pdf");
    const { patches } = build(
      { kind: "field", moduleFilePath: PAGE, patchPath: ["a"], path },
      "report",
    );
    expect(patches.primary.patch).toEqual([
      {
        op: "replace",
        path: ["a", "path"],
        value: remoteRef("public/val/report_bfbd0.pdf"),
      },
    ]);
  });

  test("a hand-placed file without a hash gets one from its bytes", () => {
    const { patches } = build(
      {
        kind: "field",
        moduleFilePath: PAGE,
        patchPath: ["a"],
        path: "/public/logo.png",
      },
      "brand",
    );
    expect(patches.newPath).toBe("/public/brand_bfbd0.png");
  });
});

describe("splitEditableFilename", () => {
  test("locks Val's hash suffix with the extension", () => {
    expect(splitEditableFilename("hero_a1b2c.png")).toEqual({
      base: "hero",
      locked: "_a1b2c.png",
    });
  });
  test("locks only the extension when there is no suffix", () => {
    expect(splitEditableFilename("logo.png")).toEqual({
      base: "logo",
      locked: ".png",
    });
    expect(splitEditableFilename("README")).toEqual({
      base: "README",
      locked: "",
    });
  });
});
