import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, publishAll, sessionCookie } from "./httpMode";

/**
 * Remote image, file and video FIELDS, uploaded through the Studio and
 * published -- by a commit, and by a publish job.
 *
 * Every project in the Val app has `files: { remote: true }`, which makes every
 * `s.image()`, `s.file()` and `s.video()` remote, so this is the media path the
 * app takes. `remoteFiles.spec.ts` drives a remote GALLERY; a field is a
 * separate upload path (`createFilePatch`, and the video field's poster beside
 * it), and nothing drove it.
 *
 * The fixture is `content/remoteFields.val.ts`, registered only in proxy mode
 * for the reason `remoteImages.val.ts` is.
 *
 * Two publishes, because they reach the content service by different routes
 * and both have to carry the files as REMOTE:
 *
 * - a commit (`/save` -> `POST /commit`), what a connected project on a host
 *   of its own does;
 * - a publish JOB (press -> `/publish-job-prepare` -> `POST /publish-jobs/{id}
 *   /prepare` -> seal), what the Val app does. The prepare is where content
 *   puts remote files on the remote host, and a ref whose bytes were not
 *   uploaded flagged remote fails it there.
 *
 * A managed job is not here: it needs a deployment that embeds its source,
 * which `examples/next` is not. valbuild/home's `pnpm loop` drives that one.
 */

const MODULE = "/content/remoteFields.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";
const FILE = "e2e/fixtures/note.txt";
const VIDEO = "e2e/fixtures/clip-320x180.webm";
const REMOTE_REF = /^https:\/\/remote\.val\.build\/file\/p\/mockproj\/b\//;

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

/** Every `file` op in the chain: where an upload put itself, and whether it said remote. */
function fileOps(page: Page): Promise<{ filePath: string; remote: boolean }[]> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              allRecords(): {
                patch: { op: string; filePath?: string; remote?: boolean }[];
              }[];
            };
          };
        };
      }
    ).__VAL_STORES__.system.patchStore;
    return store.allRecords().flatMap((record) =>
      record.patch
        .filter((op) => op.op === "file")
        .map((op) => ({
          filePath: op.filePath ?? "",
          remote: op.remote === true,
        })),
    );
  });
}

/**
 * Upload one file into each field, waiting for each to be in the chain.
 *
 * The wait on the input being enabled is the readiness boundary: a remote
 * field stays disabled until `/remote/settings` has answered AND a bucket has
 * been picked, because before that it has no ref to build. `setInputFiles`
 * does not wait for it on its own -- it sets files on a disabled input.
 */
async function uploadAll(page: Page): Promise<void> {
  const fields: { field: string; file: string; input: string }[] = [
    { field: "image", file: IMAGE, input: 'input[id^="img_input:"]' },
    { field: "file", file: FILE, input: 'input[id^="file_input:"]' },
    { field: "video", file: VIDEO, input: 'input[id^="video_input:"]' },
  ];
  for (const [index, { field, file, input }] of fields.entries()) {
    await openHttpStudio(page, `/val/~${MODULE}?p=%22${field}%22`);
    const studio = page.locator("#val-shadow-root");
    const picker = studio.locator(input).first();
    await expect(
      picker,
      `the ${field} field never became ready to upload`,
    ).toBeEnabled({ timeout: 30_000 });
    await picker.setInputFiles(file);
    // At least one more file op than before: the video adds its poster too.
    await expect
      .poll(async () => (await fileOps(page)).length, {
        timeout: 60_000,
        message: `the ${field} upload never reached the chain`,
      })
      .toBeGreaterThan(index);
    await expect
      .poll(
        async () =>
          (await mock.state()).patches.filter((p) => p.path === MODULE).length,
        { timeout: 30_000, message: `the ${field} patch was never saved` },
      )
      .toBeGreaterThan(index);
  }
}

/** What every one of these must be: a remote ref, uploaded flagged remote. */
async function expectAllRemote(page: Page): Promise<string[]> {
  const ops = await fileOps(page);
  // An image, a file, a video and the video's poster.
  expect(ops.length, JSON.stringify(ops)).toBeGreaterThanOrEqual(3);
  for (const op of ops) {
    expect(op.filePath, "a remote field built a local ref").toMatch(REMOTE_REF);
    expect(op.remote, `${op.filePath} was not marked remote`).toBe(true);
  }
  const uploaded = (await mock.state()).patchFiles;
  expect(uploaded.length).toBe(ops.length);
  for (const file of uploaded) {
    expect(file.remote, `${file.filePath} was uploaded as local`).toBe(true);
  }
  return ops.map((op) => op.filePath);
}

/** Nothing under the repo's media directories: remote files are not committed. */
function committedMedia(repoOverlay: string[]): string[] {
  return repoOverlay.filter((filePath) => /\/public\//.test(filePath));
}

test.describe("remote media fields", () => {
  test("upload remote refs, and a commit puts them in remote storage, not the repo", async ({
    page,
  }) => {
    await uploadAll(page);
    const refs = await expectAllRemote(page);

    const published = await publishAll(page, "Remote image, file and video");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(1);
    expect([...state.remoteFiles].sort()).toEqual([...refs].sort());
    expect(
      committedMedia(state.repoOverlay),
      "a remote file was committed to the repo",
    ).toEqual([]);
    const committed = await mock.committedSource(MODULE);
    for (const ref of refs) {
      expect(committed, "the commit does not name the ref").toContain(ref);
    }
  });

  test("...and a publish JOB's prepare does the same", async ({ page }) => {
    await mock.enablePublishJobs();
    await uploadAll(page);
    const refs = await expectAllRemote(page);

    const studio = page.locator("#val-shadow-root");
    const publish = studio
      .locator('[data-val-tour="publish"]')
      .getByRole("button");
    await expect(publish).toBeEnabled({ timeout: 30_000 });
    await publish.click();

    await expect
      .poll(async () => (await mock.state()).publishJobs.map((j) => j.done), {
        timeout: 60_000,
        message: "the job was never sealed",
      })
      .toEqual(["sealed"]);
    const state = await mock.state();
    const [job] = state.publishJobs;
    // What `/publish-job-prepare` sent: every file by its ref, flagged remote.
    expect(Object.keys(job.binaryFiles ?? {}).sort()).toEqual([...refs].sort());
    for (const [ref, descriptor] of Object.entries(job.binaryFiles ?? {})) {
      expect(descriptor.remote, `${ref} was prepared as local`).toBe(true);
    }
    expect(state.publishRequests.map((r) => r.status.kind)).toEqual(["live"]);
    expect(state.commits).toHaveLength(1);
    expect([...state.remoteFiles].sort()).toEqual([...refs].sort());
    expect(
      committedMedia(state.repoOverlay),
      "a remote file was committed to the repo",
    ).toEqual([]);
  });
});
