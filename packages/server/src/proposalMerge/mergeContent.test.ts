import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { mergeContent, type ModuleToMerge } from "./mergeContent";
import { valFile } from "./project";

const { s, c } = initVal();

/*
 * The content-only Update from the site: the three versions of each module a
 * proposal saved, merged under the running build's one schema. The rules are
 * the scenarios' (`mergeScenarios.test.ts`); this is the slice Val's server
 * runs at a proposal's address, with no project to load.
 */

const HOME = "/home.val.ts" as ModuleFilePath;
const homeSchema = s.object({
  title: s.string(),
  subtitle: s.string(),
  hero: s.image(),
});
const homeModule = c.define(HOME, homeSchema, {
  title: "Sale",
  subtitle: "Everything must go",
  hero: { path: "/public/val/a.png", alt: "A sale" },
});
const BASE = Internal.getSource(homeModule) as JSONValue;
const schemas = { [HOME]: homeSchema };

const home = (change: Record<string, JSONValue>) =>
  ({ ...(BASE as Record<string, JSONValue>), ...change }) as JSONValue;
const text = (content: JSONValue) =>
  valFile(
    "home.val.ts",
    "s.object({ title: s.string(), subtitle: s.string(), hero: s.image() })",
    content,
  );
const module = (site: JSONValue, proposal: JSONValue): ModuleToMerge => ({
  base: BASE,
  site,
  proposal,
  text: text(proposal),
});

describe("mergeContent", () => {
  test("different fields combine, written into the proposal's file", () => {
    const merged = mergeContent({
      modules: {
        [HOME]: module(
          home({ title: "Spring sale" }),
          home({ subtitle: "Hot deals" }),
        ),
      },
      schemas,
      resolutions: [],
    });
    expect(merged).toMatchObject({
      status: "merged",
      modules: {
        [HOME]: {
          source: home({ title: "Spring sale", subtitle: "Hot deals" }),
        },
      },
    });
    if (merged.status !== "merged") return;
    expect(merged.files["home.val.ts"]).toContain(`"Spring sale"`);
    expect(merged.files["home.val.ts"]).toContain(`"Hot deals"`);
  });

  test("the same field is a conflict, and the same value on both sides too", () => {
    for (const [site, proposal] of [
      ["Spring sale", "Summer sale"],
      ["Summer sale", "Summer sale"],
    ]) {
      expect(
        mergeContent({
          modules: {
            [HOME]: module(home({ title: site }), home({ title: proposal })),
          },
          schemas,
          resolutions: [],
        }),
      ).toEqual({
        status: "conflicts",
        conflicts: [
          {
            kind: "field",
            moduleFilePath: HOME,
            path: ["title"],
            base: "Sale",
            site,
            proposal,
          },
        ],
      });
    }
  });

  test("a resolution settles it: keep a side, or write the value", () => {
    const modules = {
      [HOME]: module(
        home({ title: "Spring sale" }),
        home({ title: "Summer sale" }),
      ),
    };
    const titleOf = (merged: ReturnType<typeof mergeContent>) =>
      merged.status === "merged"
        ? (merged.modules[HOME].source as { title: string }).title
        : merged.status;
    const at = { moduleFilePath: HOME, path: ["title"] };
    expect(
      titleOf(
        mergeContent({
          modules,
          schemas,
          resolutions: [{ ...at, keep: "site" }],
        }),
      ),
    ).toBe("Spring sale");
    expect(
      titleOf(
        mergeContent({
          modules,
          schemas,
          resolutions: [{ ...at, keep: "proposal" }],
        }),
      ),
    ).toBe("Summer sale");
    expect(
      titleOf(
        mergeContent({
          modules,
          schemas,
          resolutions: [{ ...at, value: "All seasons sale" }],
        }),
      ),
    ).toBe("All seasons sale");
  });

  test("an image is one value: a new picture and a new alt text conflict", () => {
    const merged = mergeContent({
      modules: {
        [HOME]: module(
          home({ hero: { path: "/public/val/b.png", alt: "A beach" } }),
          home({ hero: { path: "/public/val/a.png", alt: "A big sale" } }),
        ),
      },
      schemas,
      resolutions: [],
    });
    expect(merged).toMatchObject({
      status: "conflicts",
      conflicts: [{ path: ["hero"] }],
    });
  });

  test("a .jsonValues() record both sides changed waits for the full merge", () => {
    const NOTES = "/notes.val.ts" as ModuleFilePath;
    const notesSchema = s.record(s.object({ title: s.string() })).jsonValues();
    const notes = (a: string) => ({ a: { title: a } });
    expect(
      mergeContent({
        modules: {
          [NOTES]: {
            base: notes("First"),
            site: notes("Primary"),
            proposal: notes("Summer"),
            text: "",
          },
        },
        schemas: { [NOTES]: notesSchema },
        resolutions: [],
      }),
    ).toEqual({ status: "needs-full-merge", modules: [NOTES] });
  });

  test("a module the build does not have is code, and waits for the full merge", () => {
    const OTHER = "/other.val.ts" as ModuleFilePath;
    expect(
      mergeContent({
        modules: { [OTHER]: module(BASE, BASE) },
        schemas,
        resolutions: [],
      }),
    ).toEqual({ status: "needs-full-merge", modules: [OTHER] });
  });
});
