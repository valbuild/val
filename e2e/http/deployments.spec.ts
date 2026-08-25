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
 * ## What is asserted, and why it is not the UI
 *
 * The deployment banner is not reachable: `DraftChanges` — the only component
 * that renders `useDeployments()` — is imported by nothing, so the Studio
 * currently mounts no deployment UI at all. Asserting on it would mean asserting
 * on a component the app does not render.
 *
 * So these tests assert the transport instead, which is the part that silently
 * breaks: the message reaches the client and passes `WebSocketServerMessage`.
 * That parse is a zod schema in `useStatus.ts` against JSON from a service in
 * another repository, and when the two drift the whole feature stops working with
 * one `console.error` and no other symptom. The `Could not parse` assertion is
 * the point of these tests; the debug line only proves something arrived.
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
   * Note what this cannot cover in a dev-server harness. `VAL_GIT_COMMIT` is read
   * once at startup, so the app's own idea of which commit it serves cannot
   * change while it runs — a real deploy replaces the process. The commit pushed
   * here therefore deliberately carries the app's own sha: that is the state a
   * finished build leaves behind, and it is the branch `observedCommitShas` keys
   * on, without needing a restart.
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
