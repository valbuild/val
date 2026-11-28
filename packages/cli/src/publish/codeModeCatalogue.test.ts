import { execFileSync } from "child_process";
import path from "path";
import {
  casesAt,
  knownToFailAt,
  type CodeModeCase,
} from "../../../../e2e/proposal/codeModeCases";
import type {
  BuiltReport,
  CatalogueReport,
} from "./__fixtures__/codeModeCatalogueProbe";

/**
 * The code-mode catalogue at the `build` level: each case's change built by
 * the Studio's own quick preview and Build, with the real builder, over the
 * site as `val publish` stored it. What is asserted is what the page would be
 * handed: the build was made (or failed, where the case's code cannot
 * bundle), and its code and its CSS carry what the case puts on the page.
 *
 * `e2e/proposal/codeModeCases.ts` is the catalogue and says what each level
 * runs; `__fixtures__/studioBuild.ts` is how a site is published and a
 * change built. A case with a known bug at this level runs as
 * `test.failing`, so it turns red when the bug is fixed: take the bug off
 * the case then.
 *
 * The builds run in a child process because `@rolldown/browser` is ESM-only
 * and jest runs CommonJS here.
 */
let probe: CatalogueReport;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "codeModeCatalogueProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  if (line === undefined) throw new Error(`the probe said nothing:\n${out}`);
  probe = JSON.parse(line);
}, 600_000);

/** What the page is handed, against what the case says it should be. */
function expectBuilt(c: CodeModeCase, built: BuiltReport, made: string) {
  if (c.expect.preview.kind === "fails") {
    expect(built.status).toBe("failed");
    expect(built.message).not.toBeNull();
    return;
  }
  expect({ status: built.status, message: built.message }).toEqual({
    status: made,
    message: null,
  });
  for (const [wanted, there] of Object.entries(built.css)) {
    expect({ css: wanted, there }).toEqual({ css: wanted, there: true });
  }
  for (const [wanted, there] of Object.entries(built.text)) {
    expect({ text: wanted, there }).toEqual({ text: wanted, there: true });
  }
}

describe.each(casesAt("build"))("$id $title", (c) => {
  const run = knownToFailAt(c, "build") ? test.failing : test;
  const label = c.knownBug ? ` (KNOWN BUG: ${c.knownBug.what})` : "";

  run(`a quick preview hands the page the change${label}`, () => {
    expectBuilt(c, probe[c.id].quickPreview, "built");
  });

  run(`a Build hands the page the change${label}`, () => {
    if (c.expect.build === "fails") {
      expect(probe[c.id].build.status).toBe("failed");
      return;
    }
    expectBuilt(c, probe[c.id].build, "uploaded");
  });
});
