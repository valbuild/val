import { expect, test, type Page } from "@playwright/test";
import {
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";

/**
 * What arrives from outside the Studio: deployments, and commits nobody here made.
 *
 * These have no `fs`-mode equivalent at all. In proxy mode `/stat` answers
 * `use-websocket`, the browser opens a socket to the content service itself, and
 * everything that happens afterwards — a deployment starting, a deployment
 * finishing, someone pushing a commit — arrives on it. Nothing an editor does
 * produces one, which is why the mock has a control plane.
 *
 * ## What is asserted
 *
 * Two things, in two `describe`s.
 *
 * The transport, which is the part that silently breaks: the message reaches the
 * client and passes `WebSocketServerMessage`. That parse is a zod schema in
 * `useStatus.ts` against JSON from a service in another repository, and when the
 * two drift the whole feature stops working with one `console.error` and no
 * other symptom. The `Could not parse` assertion is the point of those tests;
 * the debug line only proves something arrived.
 *
 * And the deploy feed in the status bar, which is what an editor actually reads
 * after pressing Publish. It is here because of what went wrong in production:
 * a publish sat at "Queued" forever. Two separate reasons, and this file covers
 * both — no deployment event ever arrived (the feed has to reach a resting
 * state on its own), and the one signal Val does get for itself, the site
 * answering with the new commit, was only re-checked every twenty minutes and
 * was ignored unless a build had also been reported green.
 *
 * ## What a dev-server harness cannot cover
 *
 * `VAL_GIT_COMMIT` is read once at startup, so the app's own idea of which
 * commit it serves cannot change while it runs — a real deploy replaces the
 * process. So the tests below say "the site is serving this commit" the only way
 * they can: by announcing a deployment for the sha the app already booted with.
 * The transition from one served sha to another is a restart, and belongs to
 * whatever tests the deploy itself.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

/** Every console message, so a test can assert on what the socket did with one. */
function collectConsole(page: Page): { type: string; text: string }[] {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (message) =>
    messages.push({ type: message.type(), text: message.text() }),
  );
  return messages;
}

function parseFailures(messages: readonly { text: string }[]): string[] {
  return messages
    .filter((message) => /Could not parse WebSocket message/.test(message.text))
    .map((message) => message.text);
}

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("events from the content service", () => {
  test("the Studio opens a socket to the content service", async ({ page }) => {
    // `openHttpStudio` already waits for the socket, so this test is mostly a
    // named place for the failure: if the socket does not come up, every other
    // test in this file fails for a reason that looks like a missing event. What
    // it adds is the other end — the content service accepted the nonce and
    // registered a subscriber, rather than closing the connection on it.
    await openHttpStudio(page);
    await expect
      .poll(async () => (await mock.state()).subscribers, {
        message: "the content service did not accept the subscription",
      })
      .toBeGreaterThan(0);
  });

  test("a deployment announced by CI reaches the Studio", async ({ page }) => {
    const messages = collectConsole(page);
    await openHttpStudio(page);

    const announced = await mock.deployment({ deploymentState: "pending" });
    expect(announced.deployment.commitSha).toBe("mockcommit0");

    await expect
      .poll(
        () => messages.some((message) => message.text.startsWith("Deployment")),
        { message: "the deployment never reached the browser" },
      )
      .toBe(true);
    expect(parseFailures(messages)).toEqual([]);
  });

  /**
   * A deployment moving from pending to success.
   *
   * Sent as a second message about the same `deploymentId`, which is how the real
   * service reports progress, and what `mergeCommitsAndDeployments` keys on. The
   * mock updates in place so the state it reports matches: two messages, one
   * deployment.
   */
  test("a deployment that finishes updates in place", async ({ page }) => {
    const messages = collectConsole(page);
    await openHttpStudio(page);

    const started = await mock.deployment({ deploymentState: "pending" });
    await mock.deployment({
      deploymentId: started.deployment.deploymentId,
      deploymentState: "success",
    });

    await expect
      .poll(
        () =>
          messages.filter((message) => message.text.startsWith("Deployment"))
            .length,
        { message: "both deployment messages never arrived" },
      )
      .toBeGreaterThanOrEqual(2);
    expect(parseFailures(messages)).toEqual([]);

    const state = await mock.state();
    expect(state.deployments).toHaveLength(1);
    expect(state.deployments[0].deploymentState).toBe("success");
  });

  /**
   * Someone pushed a commit that did not come from this Studio.
   *
   * The build-on-a-new-commit case, from the Studio's side: a commit it did not
   * make appears on the branch it is editing.
   *
   * The commit gets a sha of its own, so from the Studio's side it is a publish
   * it did not make that has not gone out yet — which is what a push to the
   * branch is until CI has built it.
   */
  test("a commit pushed outside the Studio reaches it", async ({ page }) => {
    const messages = collectConsole(page);
    await openHttpStudio(page);

    await mock.pushCommit({
      commitMessage: "A commit from CI",
      creator: "profile-linus",
    });

    await expect
      .poll(
        () => messages.some((message) => message.text.startsWith("Commit")),
        { message: "the pushed commit never reached the browser" },
      )
      .toBe(true);
    expect(parseFailures(messages)).toEqual([]);
    expect((await mock.state()).commits).toHaveLength(1);
  });

  /**
   * The whole sequence, in the order it happens in production.
   *
   * Publish, CI builds and deploys, publish again. Worth running as one test
   * rather than four because the failure it is looking for is order-dependent: a
   * publish after a deployment has landed has to commit on top of the commit the
   * deployment was for, not on top of the sha the app booted with.
   */
  test("publish, deploy, publish again", async ({ page }) => {
    const messages = collectConsole(page);
    await openHttpStudio(page);

    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "Before the deploy" },
    ]);
    expect((await publishAll(page, "First")).status).toBe("published");
    const firstCommit = (await mock.state()).commits[0].commitSha;

    // CI picks it up, builds it, and deploys it.
    const deployment = await mock.deployment({
      commitSha: firstCommit,
      deploymentState: "pending",
    });
    await mock.deployment({
      deploymentId: deployment.deployment.deploymentId,
      deploymentState: "success",
    });

    await writePatch(page, "/content/authors.val.ts", [
      { op: "replace", path: ["teddy", "name"], value: "After the deploy" },
    ]);
    const second = await publishAll(page, "Second");
    expect(second.status, second.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(2);
    expect(state.commits[1].parentCommitSha).toBe(firstCommit);
    expect(await mock.committedSource("/content/authors.val.ts")).toContain(
      "After the deploy",
    );
    expect(parseFailures(messages)).toEqual([]);
  });
});

// #region the deploy feed

/** The Studio's shadow root, which every locator below is scoped to. */
function shell(page: Page) {
  return page.locator("#val-shadow-root");
}

/**
 * The status bar's deploy item.
 *
 * Located by its accessible name because that name IS the summary — "Building",
 * "Deployed", "Build failed" — so one locator both finds the control and says
 * what it currently claims.
 */
function deploySummary(page: Page) {
  return shell(page).getByRole("button", { name: /^Deployments: / });
}

function summaryLabel(page: Page): Promise<string> {
  return deploySummary(page)
    .getAttribute("aria-label")
    .then((label) => (label ?? "").replace(/^Deployments: /, ""));
}

/**
 * Open the publish list and keep it open.
 *
 * Two things want to close it: it may already be open because it opened itself
 * when the publish landed, and a list that opened itself closes again five
 * seconds after everything is live. Hovering is what holds that off — the
 * component treats the pointer being on the list as someone reading it — so
 * that is what these tests do rather than racing the timer.
 */
async function openDeployList(page: Page) {
  const list = shell(page).getByRole("dialog", { name: "Deployments" });
  if (!(await list.isVisible())) {
    await deploySummary(page).click();
  }
  await expect(list).toBeVisible();
  await list.hover();
  return list;
}

/** Publish one edit, and return the commit sha it made. */
async function publishOne(page: Page, name: string): Promise<string> {
  await writePatch(page, "/content/authors.val.ts", [
    { op: "replace", path: ["teddy", "name"], value: name },
  ]);
  const res = await publishAll(page, `Set the name to ${name}`);
  // The whole result, because a refusal carries its reason in `reason` rather
  // than `message` and "expected published, got refused" says nothing useful.
  expect(res.status, JSON.stringify(res)).toBe("published");
  const { commits } = await mock.state();
  return commits[commits.length - 1].commitSha;
}

test.describe("the deploy feed", () => {
  test("says nothing has been published on a quiet project", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await expect.poll(() => summaryLabel(page)).toBe("No deploys");
  });

  test("a publish shows up as soon as the commit lands", async ({ page }) => {
    await openHttpStudio(page);
    await publishOne(page, "Waiting to go out");

    await expect
      .poll(() => summaryLabel(page), {
        message: "the publish never reached the deploy feed",
      })
      .toBe("Building");
    const list = await openDeployList(page);
    await expect(
      list.getByText("Set the name to Waiting to go out"),
    ).toBeVisible();
    await expect(list.getByText(/^Queued ·/)).toBeVisible();
  });

  test("a build reported by CI moves the row through its states", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const commitSha = await publishOne(page, "Being built");
    const list = await openDeployList(page);

    const deployment = await mock.deployment({
      commitSha,
      deploymentState: "pending",
    });
    await expect(list.getByText(/^Building ·/)).toBeVisible();

    await mock.deployment({
      deploymentId: deployment.deployment.deploymentId,
      deploymentState: "success",
    });
    // Built, not live: a green build is not the same as the site answering with
    // the commit, and this app is still serving the one it booted with.
    await expect(list.getByText(/^Built ·/)).toBeVisible();
  });

  /**
   * The bug this file exists for.
   *
   * In production the deployment events never arrived at all — nothing wrote
   * them — so every publish sat at "Queued" forever while the site had long
   * since gone out. The site answering with the commit is the one thing Val can
   * establish for itself, and it has to be enough on its own: no build state
   * here ever moves past `created`.
   */
  test("a publish the site is serving is live, with no build ever reported", async ({
    page,
  }) => {
    await openHttpStudio(page);
    // `mockcommit0` by default: the sha this app booted with, which is the only
    // way a dev-server harness can say "the site is serving this".
    await mock.deployment({ deploymentState: "created" });

    await expect
      .poll(() => summaryLabel(page), {
        message: "a commit the site is serving still read as building",
      })
      .toBe("Deployed");
    const list = await openDeployList(page);
    await expect(list.getByText(/^Live ·/)).toBeVisible();
  });

  /**
   * A failure reported against a commit the site is serving.
   *
   * That build went out, so the failure is some other build of the same commit
   * — a preview environment, a job that was retried — and warning about it
   * would be warning about the site currently on screen.
   */
  test("a failure against a commit the site is serving is not a warning", async ({
    page,
  }) => {
    await openHttpStudio(page);
    await mock.deployment({ deploymentState: "failure" });

    await expect.poll(() => summaryLabel(page)).toBe("Deployed");
  });

  test("a build that failed for a publish is reported", async ({ page }) => {
    await openHttpStudio(page);
    const commitSha = await publishOne(page, "Never going out");
    await mock.deployment({ commitSha, deploymentState: "failure" });

    await expect
      .poll(() => summaryLabel(page), {
        message: "a failed build did not reach the status bar",
      })
      .toBe("Build failed");
    const list = await openDeployList(page);
    await expect(list.getByText(/^Build failed ·/)).toBeVisible();
  });

  /**
   * A deployment the socket never carried.
   *
   * The socket only pushes what the content service's database trigger fires
   * while this Studio is connected, so a reconnect or a deployment that moved
   * before the Studio was open reaches the browser only on the next `/stat`.
   * That path was broken twice over: `/stat` was only re-asked every twenty
   * minutes once a socket was up, and the merge it feeds was keyed on the
   * NUMBER of deployments — so a row changing state in place, which is exactly
   * what a build finishing looks like, changed nothing.
   */
  test("a deployment that only arrives on the next /stat still updates the feed", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const commitSha = await publishOne(page, "Deployed off-socket");
    const list = await openDeployList(page);

    const deployment = await mock.deployment({
      commitSha,
      deploymentState: "pending",
      broadcast: false,
    });
    await expect(list.getByText(/^Building ·/)).toBeVisible({
      timeout: 30_000,
    });

    await mock.deployment({
      deploymentId: deployment.deployment.deploymentId,
      deploymentState: "success",
      broadcast: false,
    });
    await expect(list.getByText(/^Built ·/)).toBeVisible({ timeout: 30_000 });
  });

  /**
   * Two builds of one commit, as `/stat` returns them: newest update first.
   *
   * The client folds the list down to one entry per commit sha and the last
   * entry it sees wins, so the order matters — and the two sources disagree
   * about it. The socket appends, newest last; the content service returns
   * `ORDER BY updated_at DESC`, newest first. Read in that order a finished
   * build was overwritten by the pending one it replaced, and the feed stuck on
   * "Building".
   */
  test("the newest build of a commit wins whatever order it arrives in", async ({
    page,
  }) => {
    await openHttpStudio(page);
    const commitSha = await publishOne(page, "Deployed twice");
    const list = await openDeployList(page);

    await mock.deployment({
      commitSha,
      deploymentState: "pending",
      broadcast: false,
    });
    // A distinguishable `updatedAt`, so the order under test is the one the
    // content service would report rather than whichever way a tie fell.
    await page.waitForTimeout(50);
    await mock.deployment({
      commitSha,
      deploymentState: "success",
      broadcast: false,
    });

    await expect(list.getByText(/^Built ·/)).toBeVisible({ timeout: 30_000 });
    expect(await summaryLabel(page)).toBe("Deployed");
  });
});

// #endregion
