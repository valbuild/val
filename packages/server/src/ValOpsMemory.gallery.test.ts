import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
  type ValModules,
} from "@valbuild/core";
import { ValOpsMemory } from "./ValOpsMemory";

/*
 * A field picked from a gallery is checked against the gallery as it is now.
 *
 * The page's schema holds the gallery as it was EVALUATED -- in a built site,
 * as it was built. An image uploaded to the gallery since is only in the
 * gallery's current Source: in a pending change, a save in a proposal, or a
 * content-only publish that never rebuilt the site. Picking it, and saving,
 * was refused with "The gallery does not have an image at …".
 */

const { s, c, config } = initVal();

const GALLERY = "/content/images.val.ts" as ModuleFilePath;
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const OLD = "/public/val/images/old.png";
const NEW =
  "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abc/f/def/p/public/val/images/new.png";
const ENTRY = { width: 8, height: 8, mimeType: "image/png", alt: null };

const gallery = c.define(GALLERY, s.imagedir("/public/val/images"), {
  [OLD]: ENTRY,
});
const page = c.define(PAGE, s.object({ hero: s.image(gallery) }), {
  hero: { path: OLD },
});

const valModules: ValModules = {
  config,
  modules: [
    { def: () => Promise.resolve({ default: gallery }) },
    { def: () => Promise.resolve({ default: page }) },
  ],
};

async function validateWithPatches(
  ops: ValOpsMemory,
  patches: {
    module: ModuleFilePath;
    patch: Parameters<ValOpsMemory["createPatch"]>[1];
  }[],
) {
  for (const { module, patch } of patches) {
    const res = await ops.createPatch(
      module,
      patch,
      crypto.randomUUID() as PatchId,
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      null,
    );
    if ("error" in res && res.error) {
      throw new Error(JSON.stringify(res.error));
    }
  }
  const fetched = await ops.fetchPatches({ excludePatchOps: false });
  const analysis = ops.analyzePatches(fetched.patches, fetched.commits);
  const tree = await ops.getSources({ ...analysis, ...fetched });
  const schemas = await ops.getSchemas();
  return ops.validateSources(schemas, tree.sources, analysis.patchesByModule);
}

const heroPath = `${PAGE}?p="hero"` as SourcePath;

describe("a gallery-backed field, checked against the gallery as it is now", () => {
  test("an image added to the gallery since the schema was built can be picked", async () => {
    const ops = new ValOpsMemory(valModules, { config, sourceFiles: {} });
    const validation = await validateWithPatches(ops, [
      {
        module: GALLERY,
        patch: [{ op: "add", path: [NEW], value: ENTRY }],
      },
      {
        module: PAGE,
        patch: [{ op: "replace", path: ["hero"], value: { path: NEW } }],
      },
    ]);
    expect(validation.errors[PAGE]?.validations[heroPath]).toBeUndefined();
  });

  test("an image the gallery does not have now is still an error, with what the field holds", async () => {
    const ops = new ValOpsMemory(valModules, { config, sourceFiles: {} });
    const validation = await validateWithPatches(ops, [
      {
        module: PAGE,
        patch: [{ op: "replace", path: ["hero"], value: { path: NEW } }],
      },
    ]);
    expect(validation.errors[PAGE]?.validations[heroPath]).toEqual([
      {
        message: `The gallery does not have an image at '${NEW}'.`,
        value: { path: NEW },
      },
    ]);
  });
});
