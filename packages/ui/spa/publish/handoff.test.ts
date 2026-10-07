import {
  builderWindowFeatures,
  handoffUrl,
  joinHandoff,
  leaveTo,
  openHandoff,
  readHandoffIntent,
  type ToSite,
  type ToTab,
} from "./handoff";

/**
 * A publish handed from a page that cannot build to a Studio tab, over a real
 * `BroadcastChannel`: the two ends here are what the site and the tab run.
 */

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Until `check` holds, or fail after a second. */
async function until(check: () => boolean) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await wait();
  }
  throw new Error("timed out");
}

const jobOf = (id: string): Extract<ToTab, { type: "job" }> => ({
  type: "job",
  job: { id, step: "prepare", base: "C0", patches: ["p1", "p2"] },
  tab: "site-tab",
  requestId: "r1",
});

const opened: string[] = [];
const open = (url: string) => {
  opened.push(url);
  return {};
};

afterEach(() => {
  opened.length = 0;
});

test("the tab opens at a url that names the handoff", () => {
  const site = openHandoff({ open });
  expect(opened).toEqual([handoffUrl(site.id)]);
  expect(site.opened).toBe(true);
  site.close();
});

/**
 * What the tab is to do travels in its URL, not over the channel: on an iPhone
 * the page is paused from the moment the tab opens, and cannot answer it.
 */
describe("the tab's URL says what it is to do", () => {
  const searchOf = (url: string) => new URL(url, "http://site").search;

  test("a press, as the page's tab, under the page's request id", () => {
    const site = openHandoff({
      open,
      intent: { kind: "press", requestId: "r1", tab: "site-tab", after: "p7" },
    });
    expect(readHandoffIntent(searchOf(opened[0] ?? ""))).toEqual({
      kind: "press",
      requestId: "r1",
      tab: "site-tab",
      after: "p7",
    });
    // The platform isolates the tab by this parameter: it is still there.
    expect(
      new URL(opened[0] ?? "", "http://site").searchParams.get(
        "publish-handoff",
      ),
    ).toBe(site.id);
    site.close();
  });

  test("a try again, naming the request it replaces", () => {
    const url = handoffUrl("h1", "/val", {
      kind: "try-again",
      requestId: "r2",
      tab: "site-tab",
      replaces: "r1",
      after: null,
    });
    expect(readHandoffIntent(searchOf(url))).toEqual({
      kind: "try-again",
      requestId: "r2",
      tab: "site-tab",
      replaces: "r1",
      after: null,
    });
  });

  test("an update", () => {
    const url = handoffUrl("h1", "/val", { kind: "update" });
    expect(readHandoffIntent(searchOf(url))).toEqual({ kind: "update" });
  });

  test("a URL that says nothing, or not enough, is a tab that waits to be told", () => {
    expect(readHandoffIntent(searchOf(handoffUrl("h1")))).toBeNull();
    expect(
      readHandoffIntent(
        "?publish-handoff=h1&publish-do=press&publish-request=r1",
      ),
    ).toBeNull();
    expect(
      readHandoffIntent(
        "?publish-handoff=h1&publish-do=try-again&publish-request=r2&publish-as=t",
      ),
    ).toBeNull();
    expect(
      readHandoffIntent(
        "?publish-handoff=h1&publish-do=build&publish-request=r1&publish-as=t",
      ),
    ).toBeNull();
  });
});

test("what the tab pressed reaches the site, and a status that is not one is dropped", async () => {
  const site = openHandoff({ open });
  const heard: ToSite[] = [];
  site.onMessage((message) => heard.push(message));
  const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
  const pressed: Extract<ToSite, { type: "pressed" }> = {
    type: "pressed",
    requestId: "r1",
    request: { kind: "queued" },
    patchIds: ["p1", "p2"],
    replaces: null,
    building: true,
  };
  // What another tab of the origin could post: a status nobody can follow.
  const channel = new BroadcastChannel("val-publish-handoff");
  channel.postMessage({
    id: site.id,
    message: { ...pressed, requestId: "junk", request: { kind: "somewhere" } },
  });
  tab.report(pressed);
  try {
    await until(() => heard.some((message) => message.type === "pressed"));
    // Two channels are not ordered: give the junk time to arrive too.
    await wait(40);
    expect(heard.filter((message) => message.type === "pressed")).toEqual([
      pressed,
    ]);
  } finally {
    channel.close();
    tab.close();
    site.close();
  }
});

test("a blocked tab is reported, so the page can offer it as a button", () => {
  const site = openHandoff({ open: () => null });
  expect(site.opened).toBe(false);
  site.close();
});

test("a tab that joins AFTER the job was sent still gets it", async () => {
  const site = openHandoff({ open });
  site.job(jobOf("J1"));
  const got: ToTab[] = [];
  const tab = joinHandoff(site.id, (message) => got.push(message), {
    retryMs: 10,
  });
  await until(() => got.length > 0);
  expect(got[0]).toEqual(jobOf("J1"));
  tab.close();
  site.close();
});

test("a tab that joins BEFORE the job gets it when it is sent", async () => {
  const site = openHandoff({ open });
  const got: ToTab[] = [];
  const tab = joinHandoff(site.id, (message) => got.push(message), {
    retryMs: 10,
  });
  await wait(40);
  expect(got).toEqual([]);
  site.job(jobOf("J2"));
  await until(() => got.length > 0);
  expect(got[0]?.type).toBe("job");
  tab.close();
  site.close();
});

test("another publish's messages are not this one's", async () => {
  const mine = openHandoff({ open });
  const other = openHandoff({ open });
  const got: ToTab[] = [];
  const tab = joinHandoff(mine.id, (message) => got.push(message), {
    retryMs: 10,
  });
  other.job(jobOf("theirs"));
  await wait(60);
  expect(got).toEqual([]);
  tab.close();
  mine.close();
  other.close();
});

test("a press that started no job tells the tab", async () => {
  const site = openHandoff({ open });
  const got: ToTab[] = [];
  const tab = joinHandoff(site.id, (message) => got.push(message), {
    retryMs: 10,
  });
  site.cancel("Validation failed");
  await until(() => got.length > 0);
  expect(got[0]).toEqual({ type: "cancel", message: "Validation failed" });
  tab.close();
  site.close();
});

test("the tab's progress and result reach the site", async () => {
  const site = openHandoff({ open });
  const heard: ToSite[] = [];
  site.onMessage((message) => heard.push(message));
  const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
  tab.report({ type: "phase", label: "Building", elapsedMs: 4_000 });
  tab.report({
    type: "done",
    result: { status: "live", url: null },
    ms: 12_000,
  });
  await until(() => heard.some((message) => message.type === "done"));
  expect(heard.filter((message) => message.type !== "ready")).toEqual([
    { type: "phase", label: "Building", elapsedMs: 4_000 },
    {
      type: "done",
      result: { status: "live", url: null },
      ms: 12_000,
    },
  ]);
  tab.close();
  site.close();
});

test("a failure crosses as a sentence, with the technical message beside it", async () => {
  const site = openHandoff({ open });
  const heard: ToSite[] = [];
  site.onMessage((message) => heard.push(message));
  const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
  tab.report({
    type: "done",
    result: {
      status: "failed",
      message: "rolldown: out of memory",
      problems: [],
    },
    ms: 3_000,
    summary: "The site could not be built from this change.",
  });
  await until(() => heard.some((message) => message.type === "done"));
  expect(heard.find((message) => message.type === "done")).toEqual({
    type: "done",
    result: {
      status: "failed",
      message: "rolldown: out of memory",
      problems: [],
    },
    ms: 3_000,
    summary: "The site could not be built from this change.",
  });
  tab.close();
  site.close();
});

test("the tab's part of the job reaches the site, before the publish is Live", async () => {
  const site = openHandoff({ open });
  const heard: ToSite[] = [];
  site.onMessage((message) => heard.push(message));
  const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
  tab.report({
    type: "job-result",
    result: { status: "handed-off", jobId: "J1", built: true },
  });
  tab.report({
    type: "job-result",
    result: { status: "failed", jobId: "J2", message: "rolldown" },
  });
  await until(
    () => heard.filter((message) => message.type === "job-result").length > 1,
  );
  expect(heard.filter((message) => message.type === "job-result")).toEqual([
    {
      type: "job-result",
      result: { status: "handed-off", jobId: "J1", built: true },
    },
    {
      type: "job-result",
      result: { status: "failed", jobId: "J2", message: "rolldown" },
    },
  ]);
  tab.close();
  site.close();
});

test("a job that is not one is dropped, not built", async () => {
  const site = openHandoff({ open });
  const got: ToTab[] = [];
  const tab = joinHandoff(site.id, (message) => got.push(message), {
    retryMs: 10,
  });
  // What another tab of the origin could post on the shared channel.
  const channel = new BroadcastChannel("val-publish-handoff");
  channel.postMessage({
    id: site.id,
    message: { ...jobOf("J4"), job: { id: "J4", patches: "p1" } },
  });
  channel.postMessage({ id: site.id, message: jobOf("J5") });
  try {
    await until(() => got.length > 0);
    expect(got[0]).toEqual(jobOf("J5"));
  } finally {
    // An open channel keeps jest alive, and a failure would hang instead.
    channel.close();
    tab.close();
    site.close();
  }
});

/*
 * An update handed to a tab: the Studio in WebKit cannot build, so pressing
 * Update site opens a tab that can. Nothing is saved first, so the page sends
 * `update` at once -- and it has to survive a tab that joins late, exactly as
 * a job does.
 */
describe("an update handed to a tab", () => {
  test("reaches a tab that joins after it was sent", async () => {
    const site = openHandoff({ open });
    site.update();
    const got: ToTab[] = [];
    const tab = joinHandoff(site.id, (message) => got.push(message), {
      retryMs: 10,
    });
    await until(() => got.length > 0);
    expect(got[0]).toEqual({ type: "update" });
    tab.close();
    site.close();
  });

  test("its ending reaches the site as an update, not as a publish", async () => {
    const site = openHandoff({ open });
    const heard: ToSite[] = [];
    site.onMessage((message) => heard.push(message));
    const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
    tab.report({
      type: "update-done",
      outcome: {
        status: "updated",
        changes: [
          {
            name: "@valbuild/core",
            section: "dependencies",
            from: "0.136.8",
            to: "0.140.0",
          },
        ],
      },
    });
    await until(() => heard.some((m) => m.type === "update-done"));
    expect(heard.find((m) => m.type === "update-done")).toEqual({
      type: "update-done",
      outcome: {
        status: "updated",
        changes: [
          {
            name: "@valbuild/core",
            section: "dependencies",
            from: "0.136.8",
            to: "0.140.0",
          },
        ],
      },
    });
    tab.close();
    site.close();
  });

  test("a refusal and a failure keep their sentences", async () => {
    const site = openHandoff({ open });
    const heard: ToSite[] = [];
    site.onMessage((message) => heard.push(message));
    const tab = joinHandoff(site.id, () => undefined, { retryMs: 10 });
    tab.report({
      type: "update-done",
      outcome: { status: "unavailable", message: "Depends on left-pad." },
    });
    tab.report({
      type: "update-done",
      outcome: {
        status: "failed",
        message: "Your site is unchanged.",
        details: "PLATFORM501",
        deploy: null,
      },
    });
    await until(
      () => heard.filter((m) => m.type === "update-done").length === 2,
    );
    expect(
      heard
        .filter((m) => m.type === "update-done")
        .map((m) => (m.type === "update-done" ? m.outcome : null)),
    ).toEqual([
      { status: "unavailable", message: "Depends on left-pad." },
      {
        status: "failed",
        message: "Your site is unchanged.",
        details: "PLATFORM501",
        deploy: null,
      },
    ]);
    tab.close();
    site.close();
  });

  test("a change list with junk in it keeps only the changes", async () => {
    const site = openHandoff({ open });
    const heard: ToSite[] = [];
    site.onMessage((message) => heard.push(message));
    const channel = new BroadcastChannel("val-publish-handoff");
    channel.postMessage({
      id: site.id,
      message: {
        type: "update-done",
        outcome: {
          status: "updated",
          changes: [
            { name: "ok", section: "dependencies", from: null, to: "1" },
            { name: "gone", section: "dependencies", from: "1", to: null },
            { name: "bad", section: "peerDependencies", from: null, to: "1" },
            { name: "worse", section: "dependencies", from: null, to: 2 },
            "not a change",
          ],
        },
      },
    });
    try {
      await until(() => heard.some((m) => m.type === "update-done"));
      expect(heard.find((m) => m.type === "update-done")).toEqual({
        type: "update-done",
        outcome: {
          status: "updated",
          changes: [
            { name: "ok", section: "dependencies", from: null, to: "1" },
            // A removal is a change; a version that is not one is not.
            { name: "gone", section: "dependencies", from: "1", to: null },
          ],
        },
      });
    } finally {
      channel.close();
      site.close();
    }
  });
});

test("the builder opens as a popup window, never as noopener", () => {
  const features = builderWindowFeatures({});
  expect(features.split(",")).toEqual(["popup", "width=480", "height=680"]);
  // `noopener` makes `window.open` return null: every handoff would read as blocked.
  expect(features).not.toMatch(/noopener|noreferrer/);
});

test("the builder window is centred across the page that opened it", () => {
  const features = builderWindowFeatures({
    screenX: 100,
    screenY: 50,
    outerWidth: 1480,
    outerHeight: 1030,
  });
  expect(features.split(",")).toEqual([
    "popup",
    "width=480",
    "height=680",
    "left=600",
    "top=167",
  ]);
});

test("a page smaller than the window does not position it off the page", () => {
  const features = builderWindowFeatures({
    screenX: 0,
    screenY: 0,
    outerWidth: 400,
    outerHeight: 600,
  });
  expect(features).not.toMatch(/left=|top=/);
});

/**
 * "View site" and "Open Studio" from the builder: in a tab of their own, and
 * the builder closes -- it is a popup the size of the publish card.
 */
function leaveScope(opens: boolean) {
  const calls: string[] = [];
  const scope = {
    open: (url: string, target: string) => {
      calls.push(`open ${url} ${target}`);
      return opens ? {} : null;
    },
    close: () => {
      calls.push("close");
    },
    location: { href: "/val?publish-handoff=x" },
  };
  return { scope, calls };
}

test("leaving the builder opens a normal tab and closes the builder", () => {
  const { scope, calls } = leaveScope(true);
  leaveTo("/", scope);
  expect(calls).toEqual(["open / _blank", "close"]);
  expect(scope.location.href).toBe("/val?publish-handoff=x");
});

test("a builder whose new tab is blocked stays open and navigates instead", () => {
  const { scope, calls } = leaveScope(false);
  leaveTo("/val", scope);
  expect(calls).toEqual(["open /val _blank"]);
  expect(scope.location.href).toBe("/val");
});
