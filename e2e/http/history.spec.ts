import { expect, test } from "@playwright/test";
import {
  mock,
  openHttpStudio,
  peek,
  publishAll,
  sessionCookie,
  USERS,
  writePatch,
} from "./httpMode";
import {
  MOCK_API_KEY,
  MOCK_CONTENT_PORT,
  MOCK_PROJECT,
  MOCK_ROOT,
} from "./config";

/**
 * History, end to end: a publish records what a later restore needs, and the
 * app can read it back several commits later.
 *
 * Every assertion here is at a boundary — the archive the content service
 * stored, or an `/api/val/history/*` response — because the claim under test is
 * exactly that the pieces agree across processes: the Studio computes each
 * changed module's data and schema and sends them, the content service keeps
 * them per commit, and `getHistoricalPatchSet` hands them back with the paths
 * the commit changed. A unit test on any one of those passes while the chain is
 * broken; the publish suite proved that once already with `x-val-profile-id`.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

const MODULE = "/content/authors.val.ts";
/** The module's path in the repository, which is how history names files. */
const MODULE_GIT_PATH = "examples/next/content/authors.val.ts";
/** What the module ships with, before any test touches it. */
const ORIGINAL_TEDDY = "Theodor René Carlsen";
const ORIGINAL_FREEKH = "Fredrik Ekholdt";

type HistoricalCommit = {
  commitSha: string;
  message: string | null;
  patchCount: number;
  hasArchive: boolean;
};

type HistoricalPatchSet = {
  modules: Record<
    string,
    {
      source: unknown;
      schema: { type?: string } | null;
      changedPaths: string[];
      failures: { kind: string }[];
    }
  >;
  patches: unknown[];
  warnings: unknown[];
};

function nameOf(source: unknown, author: string): unknown {
  const record = source as Record<string, { name?: unknown }> | null;
  return record?.[author]?.name;
}

/** Two publishes on one module, so there is a "several commits later". */
async function publishTwice(page: Parameters<typeof openHttpStudio>[0]) {
  await writePatch(page, MODULE, [
    { op: "replace", path: ["teddy", "name"], value: "First value" },
  ]);
  expect((await publishAll(page, "First publish")).status).toBe("published");
  await writePatch(page, MODULE, [
    { op: "replace", path: ["freekh", "name"], value: "Second value" },
  ]);
  expect((await publishAll(page, "Second publish")).status).toBe("published");
  const [first, second] = (await mock.state()).commits;
  return { first, second };
}

test.describe("history in http mode", () => {
  test("a publish is recorded so that a later reader can reconstruct it", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const { first, second } = await publishTwice(page);

    // A commit nobody made through the Studio: no archive, standing in for a
    // commit from before history was recorded.
    await mock.pushCommit({ commitMessage: "A push from CI" });

    /*
     * The archive first, because it is what the client SENT.
     *
     * `modules` is computed by `prepare` on the Val side and only exists in
     * history if `ValOpsHttp.commit` puts it on the wire. Reading it back from
     * the content service is the one assertion that catches the client silently
     * dropping it — the app's own `/history/commit` would then report
     * `source-unavailable`, which is also what a content service that failed to
     * store it would produce.
     */
    const state = await mock.state();
    expect(state.archives).toEqual([first.commitSha, second.commitSha]);
    const archive = await mock.archive(first.commitSha);
    expect(archive, "the publish left no archive behind").not.toBeNull();
    const stored = archive?.modules[MODULE];
    expect(stored, "the commit carried no data for the module").toBeTruthy();
    // The DATA after the commit, not the `.val.ts` text.
    expect(nameOf(stored?.source, "teddy")).toBe("First value");
    expect(nameOf(stored?.source, "freekh")).toBe(ORIGINAL_FREEKH);
    // And the schema it was written under, serialized.
    expect(stored?.schema).toMatchObject({ type: "record" });
    expect(archive?.patches.map((patch) => patch.path)).toEqual([MODULE]);
    // `change` is asked of the module versions earlier commits recorded, the
    // way `home` asks its index. History only started with the first commit,
    // so that one reads the module as added, and the second as modified.
    expect(archive?.affectedFiles).toContainEqual({
      kind: "module-source",
      gitPath: MODULE_GIT_PATH,
      change: "added",
    });
    expect(
      (await mock.archive(second.commitSha))?.affectedFiles,
    ).toContainEqual({
      kind: "module-source",
      gitPath: MODULE_GIT_PATH,
      change: "modified",
    });

    // The listing: newest first, and honest about what each commit has.
    const listRes = await page.request.get(
      "/api/val/history/commits?branch=main",
    );
    expect(listRes.status()).toBe(200);
    const listing = (await listRes.json()) as { commits: HistoricalCommit[] };
    expect(listing.commits.map((commit) => commit.message)).toEqual([
      "A push from CI",
      "Second publish",
      "First publish",
    ]);
    expect(listing.commits[0].hasArchive).toBe(false);
    expect(listing.commits[0].patchCount).toBe(0);
    expect(listing.commits[2].hasArchive).toBe(true);
    expect(listing.commits[2].patchCount).toBe(1);

    /*
     * The FIRST commit, read after two more landed.
     *
     * Its module has to be the data as that commit left it, under a schema this
     * Val can read, with nothing from the second commit leaking in — that is
     * what "several commits later" means.
     */
    const firstRes = await page.request.get(
      `/api/val/history/commit?commit_sha=${first.commitSha}`,
    );
    expect(firstRes.status()).toBe(200);
    // Immutable, so flipping between commits is served from the browser cache.
    expect(firstRes.headers()["cache-control"]).toContain("immutable");
    const firstModule = ((await firstRes.json()) as HistoricalPatchSet).modules[
      MODULE
    ];
    expect(
      firstModule,
      "the commit's module was not reconstructed",
    ).toBeTruthy();
    expect(firstModule.failures).toEqual([]);
    expect(firstModule.schema?.type).toBe("record");
    expect(nameOf(firstModule.source, "teddy")).toBe("First value");
    expect(nameOf(firstModule.source, "freekh")).toBe(ORIGINAL_FREEKH);

    // The second commit's data carries both values: it was made on top of the
    // first, and the record is what the chain produced, not the working tree.
    const secondRes = await page.request.get(
      `/api/val/history/commit?commit_sha=${second.commitSha}`,
    );
    expect(secondRes.status()).toBe(200);
    const secondModule = ((await secondRes.json()) as HistoricalPatchSet)
      .modules[MODULE];
    expect(nameOf(secondModule.source, "teddy")).toBe("First value");
    expect(nameOf(secondModule.source, "freekh")).toBe("Second value");

    // The pushed commit reads, and reads as empty rather than as an error.
    const pushedRes = await page.request.get(
      `/api/val/history/commit?commit_sha=${listing.commits[0].commitSha}`,
    );
    expect(pushedRes.status()).toBe(200);
    const pushedSet = (await pushedRes.json()) as HistoricalPatchSet;
    expect(pushedSet.modules).toEqual({});
    expect(pushedSet.patches).toEqual([]);
  });

  /**
   * A file at a commit is that commit's file, not the head's.
   *
   * The whole point of a snapshot per commit: without one, every historical
   * `<img>` and every entry read would quietly show today's bytes under an
   * old commit's sha, and nothing in the JSON would reveal it.
   */
  test("a file is served as it was at the commit asked for", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const { first, second } = await publishTwice(page);

    const atFirst = await page.request.get(
      `/api/val/history/files?commit_sha=${first.commitSha}&path=${MODULE_GIT_PATH}`,
    );
    expect(atFirst.status()).toBe(200);
    const firstText = await atFirst.text();
    expect(firstText).toContain("First value");
    expect(firstText).not.toContain("Second value");

    const atSecond = await page.request.get(
      `/api/val/history/files?commit_sha=${second.commitSha}&path=${MODULE_GIT_PATH}`,
    );
    expect(atSecond.status()).toBe(200);
    const secondText = await atSecond.text();
    expect(secondText).toContain("First value");
    expect(secondText).toContain("Second value");
  });

  /**
   * "Put everything back", through the real Studio, then released.
   *
   * The whole feature in one line: open the module with an older commit beside
   * it, put the module back the way that commit left it, publish. What proves it
   * is the committed text: it must hold the first commit's value and the
   * original of the field the second commit changed — and not the second
   * commit's value, which is what was undone.
   */
  test("a whole module can be put back from a commit and published", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const { first } = await publishTwice(page);

    // The same Studio route, with the commit beside it. `commit` in the query is
    // the whole difference between the Studio and the history Studio.
    await openHttpStudio(
      page,
      `/val/~${MODULE}?p=%22teddy%22&commit=${first.commitSha}`,
    );
    const studio = page.locator("#val-shadow-root");
    const putBack = studio.getByRole("button", { name: "Put everything back" });
    await expect(putBack).toBeEnabled({ timeout: 30_000 });
    await putBack.click();

    // Staged, not applied: the restore is a pending change until it is
    // published, exactly like any other edit.
    const published = await publishAll(page, "Put it back");
    expect(published.status, published.message ?? "").toBe("published");

    const committed = await mock.committedSource(MODULE);
    expect(committed).toContain("First value");
    expect(committed).toContain(ORIGINAL_FREEKH);
    expect(committed).not.toContain("Second value");
    // Teddy's original is gone for good: the first commit changed it, and the
    // first commit is what was put back.
    expect(committed).not.toContain(ORIGINAL_TEDDY);
  });

  /**
   * The directed restore, through the real Studio: pick a field on the right,
   * pick where it goes on the left, stage, publish.
   *
   * The scenario separates the two commits by FIELD so the result is
   * unambiguous: the first commit set teddy's name, the second changed it
   * again. Restoring teddy's name from the first commit has to bring the first
   * value back and leave everything else as the second commit left it.
   */
  test("a single field can be restored from a commit and published", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await writePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "First value" },
    ]);
    expect((await publishAll(page, "First publish")).status).toBe("published");
    await writePatch(page, MODULE, [
      { op: "replace", path: ["teddy", "name"], value: "Changed later" },
      { op: "replace", path: ["freekh", "name"], value: "Second value" },
    ]);
    expect((await publishAll(page, "Second publish")).status).toBe("published");
    const [first] = (await mock.state()).commits;

    await openHttpStudio(
      page,
      `/val/~${MODULE}?p=%22teddy%22&commit=${first.commitSha}`,
    );
    const studio = page.locator("#val-shadow-root");
    await studio.getByRole("button", { name: "Restore from here" }).click();

    // The field, as `Field` labels it, on each pane. The right pane wraps the
    // field in a click target of its own; the left pane's chrome is the field's
    // direct parent.
    const namePath = `${MODULE}?p="teddy"."name"`;
    const sourceField = studio.locator(
      `[data-restore-role="source"] > div > div[data-val-studio-path='${namePath}']`,
    );
    await expect(sourceField).toBeVisible({ timeout: 30_000 });
    await sourceField.click();

    // Marked before anything is clicked: a string can go where a string is.
    const nameTarget = studio.locator(
      `[data-restore-role="target"]:has(> div[data-val-studio-path='${namePath}'])`,
    );
    await expect(nameTarget).toHaveAttribute(
      "data-restore-status",
      "compatible",
    );
    // And a string cannot go where a date is, and says so without a click.
    const birthdateTarget = studio.locator(
      `[data-restore-role="target"]:has(> div[data-val-studio-path='${MODULE}?p="teddy"."birthdate"'])`,
    );
    await expect(birthdateTarget).toHaveAttribute(
      "data-restore-status",
      "incompatible",
    );
    // Only a click on the chrome itself picks on the live side, so the field's
    // own controls stay usable. The border is the chrome.
    await nameTarget.click({ position: { x: 3, y: 3 } });
    await studio.getByRole("button", { name: "Stage this restore" }).click();
    await expect(
      studio.getByText("Staged. It is in your pending changes"),
    ).toBeVisible();

    const published = await publishAll(page, "Restore teddy");
    expect(published.status, published.message ?? "").toBe("published");
    const committed = await mock.committedSource(MODULE);
    expect(committed).toContain("First value");
    expect(committed).not.toContain("Changed later");
    // The other field keeps what the second commit gave it: one field came
    // back, not the commit.
    expect(committed).toContain("Second value");
  });

  /**
   * A value that only breaks a RULE is still restorable.
   *
   * `name` has `minLength(2)`. A one-letter name is a valid string in an
   * invalid state, and the restore gate is type compatibility, not validation:
   * the restore stages like any other edit. Publishing is a different gate -
   * the Studio refuses to release content with validation errors - so the
   * restore waits in pending changes until the value is fixed, and says why.
   *
   * The Studio cannot publish such a commit in the first place, for the same
   * reason, so the commit is written straight to the content service - the way
   * one from another tool, or from before a rule was tightened, would arrive.
   */
  test("a value that fails validation but not the type restores, and publish then waits for a fix", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const current = (await peek(page, MODULE)) as Record<
      string,
      Record<string, unknown>
    >;
    const schemaRes = await page.request.get("/api/val/schema");
    expect(schemaRes.status()).toBe(200);
    const schemas = (
      (await schemaRes.json()) as {
        schemas: Record<string, unknown>;
      }
    ).schemas;
    const seeded = { ...current, teddy: { ...current.teddy, name: "X" } };
    const seededRes = await fetch(
      `http://localhost:${MOCK_CONTENT_PORT}/v1/${MOCK_PROJECT}/commit`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MOCK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patchedSourceFiles: {},
          patchedBinaryFilesDescriptors: {},
          appliedPatches: {},
          root: MOCK_ROOT,
          message: "A one-letter name",
          committer: USERS.ada.profileId,
          existingBranch: "main",
          modules: { [MODULE]: { source: seeded, schema: schemas[MODULE] } },
        }),
      },
    );
    expect(seededRes.ok).toBe(true);
    const { commit } = (await seededRes.json()) as { commit: string };

    await openHttpStudio(
      page,
      `/val/~${MODULE}?p=%22teddy%22&commit=${commit}`,
    );
    const studio = page.locator("#val-shadow-root");
    await studio.getByRole("button", { name: "Restore from here" }).click();
    const namePath = `${MODULE}?p="teddy"."name"`;
    await studio
      .locator(
        `[data-restore-role="source"] > div > div[data-val-studio-path='${namePath}']`,
      )
      .click();
    const nameTarget = studio.locator(
      `[data-restore-role="target"]:has(> div[data-val-studio-path='${namePath}'])`,
    );
    // Type-compatible, so offered - the rule it breaks is not the gate here.
    await expect(nameTarget).toHaveAttribute(
      "data-restore-status",
      "compatible",
    );
    await nameTarget.click({ position: { x: 3, y: 3 } });
    await studio.getByRole("button", { name: "Stage this restore" }).click();
    await expect(
      studio.getByText("Staged. It is in your pending changes"),
    ).toBeVisible();
    // Staged means a pending patch reached the content service.
    await expect
      .poll(
        async () =>
          (await mock.state()).patches.filter(
            (patch) => patch.applied === null && patch.path === MODULE,
          ).length,
      )
      .toBe(1);

    // And release waits, with the reason, rather than shipping a broken value.
    const published = await publishAll(page, "Restore the short name");
    expect(published.status).toBe("refused");
    expect(JSON.stringify(published)).toContain("validation-errors");
  });

  test("a commit Val did not make is a 404, not an empty answer", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const res = await page.request.get(
      "/api/val/history/commit?commit_sha=0000000000000000000000000000000000000000",
    );
    expect(res.status()).toBe(404);
  });

  /**
   * `changedPaths` is what the history pane highlights, so each one has to be
   * a SourcePath the Studio can resolve: one JSON-quoted segment per level,
   * joined with `.` — the same shape `peek` accepts and the URL carries.
   *
   * Last in the file on purpose: this suite runs serially and a failure here
   * must not skip the tests after it. It pins a FORMAT rather than a value: a change that
   * writes the whole op path into one segment (`?p="teddy.name"`) still names
   * something, it just names a field that does not exist.
   */
  test("the paths a commit changed resolve to the fields it changed", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const { first, second } = await publishTwice(page);
    const firstRes = await page.request.get(
      `/api/val/history/commit?commit_sha=${first.commitSha}`,
    );
    const firstModule = ((await firstRes.json()) as HistoricalPatchSet).modules[
      MODULE
    ];
    expect(firstModule.changedPaths).toEqual([`${MODULE}?p="teddy"."name"`]);
    const secondRes = await page.request.get(
      `/api/val/history/commit?commit_sha=${second.commitSha}`,
    );
    const secondModule = ((await secondRes.json()) as HistoricalPatchSet)
      .modules[MODULE];
    expect(secondModule.changedPaths).toEqual([`${MODULE}?p="freekh"."name"`]);
  });
});
