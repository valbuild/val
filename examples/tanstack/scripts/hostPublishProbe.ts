/*
 * Can a host whose publish is a BUILD configure Val for it?
 *
 * `pnpm --filter @valbuild/val-examples-tanstack probe:host-publish`
 *
 * ## What this is for
 *
 * Most hosts deploy: a save becomes a git commit, something notices the commit,
 * and a new version of the app appears minutes later. A host that builds its own
 * output has the same commit to make and then has to do something else with the
 * files — build them — because nothing else will. Val has two seams for that
 * shape, and nothing exercised them together:
 *
 * - **`http` on BOTH halves.** `initValServer` is the Studio API; `initValContent`
 *   is the readers, which have a Val server of their own and are configured
 *   separately. Configuring one and not the other leaves the other inferring a
 *   mode, and on a host that hands Val its credentials in code rather than
 *   through the environment there is nothing left to infer from.
 * - **`publishOverride`.** It is handed `commitToGit` rather than having it
 *   skipped, so a host can replace the commit or ADD to it. This drives the ADD
 *   case, which is the interesting one and the one with an ordering requirement.
 *
 * ## The claim it exists to check
 *
 * **Commit, then build.** A host that built first would hand its builder content
 * the content service does not have yet, so every read in the new build would
 * resolve the commit BEFORE the save — the site showing pre-save content with
 * the edits already consumed, and nothing failing anywhere to say so.
 *
 * That is asserted on an ordered event log rather than on two timestamps. The
 * first version of this compared `Date.now()` at each point and both landed in
 * the same millisecond, so the check passed without observing anything.
 *
 * ## Why a script and not a Playwright test
 *
 * There is no browser in it. What is under test is the CONFIGURATION — which
 * `ValOps` gets built, what it talks to, and what a publish does — and all of
 * that is reachable by calling `valApiHandler` with a `Request`. `e2e/http/`
 * already drives the Studio against this same mock content host; this is the
 * half of the product that has no UI.
 *
 * Run it after `preconstruct build`, and run `preconstruct dev` afterwards.
 * The dev entries preconstruct writes are CJS indirections and Node's ESM
 * loader cannot see named exports through them, which arrives as
 * "does not provide an export named 'initVal'" — a message about nothing that
 * is wrong with this code. Hence the dynamic imports below: they let that be
 * caught and explained rather than thrown from the import graph.
 */
import { spawn } from "node:child_process";

const load = async () => {
  try {
    return {
      ...(await import("@valbuild/tanstack/server")),
      ...(await import("../../../packages/server/src/jwt")),
      ...(await import("../val.config")),
      valModules: (await import("../val.modules")).default,
    };
  } catch (error) {
    const message = String(error);
    if (message.includes("does not provide an export")) {
      console.error(
        "This needs BUILT packages, not preconstruct's dev entries: they are CJS\n" +
          "indirections and Node's ESM loader cannot see named exports through them.\n\n" +
          "  pnpm preconstruct build   # from the repository root\n" +
          "  pnpm --filter example-tanstack run probe:host-publish\n" +
          "  pnpm preconstruct dev     # restore the source-mapped entries\n",
      );
      process.exit(2);
    }
    throw error;
  }
};

const PORT = Number(process.env.PROBE_CONTENT_PORT ?? 4199);
const CONTENT = `http://localhost:${PORT}`;
const API_KEY = "probe-api-key";
const VAL_SECRET = "probe-val-secret";
/** What this "build" was made from. Every read resolves the file AT this sha. */
const BUILT_AT = "1111111111111111111111111111111111111111";

/*
 * The host's environment, set before Val reads it.
 *
 * `VAL_ENV=app` is what a host with no disk says about itself, and it makes a
 * missing credential an error instead of a fall-through to `fs` mode looking
 * for a working tree that is not there. It is redundant here — `http` is passed
 * explicitly — and that is the point: the two must agree.
 */
process.env.VAL_ENV = "app";
delete process.env.VAL_MODE;

// After the environment is set, never before: `initHandlerOptions` reads it.
const { initValContent, initValServer, encodeJwt, config, valModules } =
  await load();

const results: Array<[string, boolean, string]> = [];
const check = (label: string, ok: boolean, detail = "") =>
  results.push([label, ok, detail]);

/**
 * What happened, in the order it happened.
 *
 * A sequence, not timestamps: see the header.
 */
const events: Array<string> = [];
/** What the host's builder was handed. */
const built: Array<{ commitSha?: string; files: Array<string> }> = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : String((input as Request).url ?? input);
  if (url.includes("host.invalid")) {
    // Stands in for whatever a host posts its files to. `.invalid` is reserved
    // and resolves nowhere, so a missing stub here fails rather than reaching
    // something real.
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      commitSha?: string;
      files?: Record<string, unknown>;
    };
    events.push("build");
    built.push({
      commitSha: body.commitSha,
      files: Object.keys(body.files ?? {}),
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes("/commit")) events.push("commit");
  return realFetch(input, init);
}) as typeof fetch;

const http = {
  apiKey: API_KEY,
  valSecret: VAL_SECRET,
  gitCommit: BUILT_AT,
  gitBranch: "main",
  valContentUrl: CONTENT,
};

const { valApiHandler, draftMode } = initValServer(
  valModules,
  { ...config },
  {
    http,
    publishOverride: async ({ patchedSourceFiles, commitToGit }) => {
      const committed = await commitToGit();
      if (committed.error) return committed;
      await fetch("https://host.invalid/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: patchedSourceFiles,
          // The sha the NEXT build has to be wired at, not a receipt: build at
          // the previous one and the new build reads the file as it was before
          // the save it is reacting to.
          commitSha: committed.commit,
        }),
      });
      return committed;
    },
  },
);

const content = initValContent(config, valModules, { draftMode, http });

const session = encodeJwt(
  {
    sub: "probe-user",
    exp: Math.floor(Date.now() / 1000) + 3600,
    token: "probe-token",
    org: "valbuild",
    project: "val-examples-tanstack",
  },
  VAL_SECRET,
);

const call = (path: string, method: string, body?: unknown) =>
  valApiHandler(
    new Request(`http://localhost:3000/api/val${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        // URL-encoded: `encodeJwt` uses STANDARD base64, so a segment can end
        // in `=` and a cookie parser splitting on the first `=` then sees one
        // segment where there should be three.
        cookie: `val_session=${encodeURIComponent(session)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

/** The mock content host, started here so this is one command and not a ritual. */
const mock = spawn("pnpm", ["exec", "tsx", "e2e/mock-content-host/server.ts"], {
  cwd: new URL("../../../", import.meta.url).pathname,
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    MOCK_CONTENT_PORT: String(PORT),
    MOCK_CONTENT_API_KEY: API_KEY,
    MOCK_CONTENT_PROJECT: "valbuild/val-examples-tanstack",
    MOCK_CONTENT_REPO_ROOT: new URL("../../../", import.meta.url).pathname,
    MOCK_CONTENT_INITIAL_COMMIT: BUILT_AT,
  },
});
// Detached and killed by process GROUP: a bare `kill(child.pid)` leaves the
// `tsx` the package manager spawned holding the port, and the next run fails
// on a port that nothing visible owns.
process.on("exit", () => {
  try {
    if (mock.pid) process.kill(-mock.pid);
  } catch {
    /* already gone */
  }
});

const ready = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await realFetch(`${CONTENT}/__test__/ping`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

void (async () => {
  if (!(await ready())) {
    console.error(`the mock content host did not come up on ${CONTENT}`);
    process.exit(1);
  }
  await realFetch(`${CONTENT}/__test__/reset`, { method: "POST" });

  check(
    "initValContent accepted `http`",
    typeof content.fetchValStega === "function",
  );

  // --- the mode -------------------------------------------------------------
  const stat = await call("/stat", "POST", null);
  const statBody = (await stat.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  check(
    "Val answered /stat",
    stat.ok,
    `${stat.status} ${JSON.stringify(statBody).slice(0, 200)}`,
  );
  check(
    "...in http mode",
    statBody["mode"] === "http",
    String(statBody["mode"]),
  );
  check(
    "...with the session recognised",
    statBody["profileId"] === "probe-user",
    String(statBody["profileId"]),
  );
  const baseSha = statBody["baseSha"];
  check(
    "...reading its base from the content service",
    typeof baseSha === "string" && baseSha.length > 0,
    String(baseSha),
  );

  // --- a patch --------------------------------------------------------------
  const patchId = crypto.randomUUID();
  const put = await call("/patches", "PUT", {
    parentRef: { type: "head", headBaseSha: baseSha },
    patches: [
      {
        // Relative to `root`, not to the repository. A repo path is ACCEPTED —
        // the content service does not validate them — and then fails at
        // `prepare`, which is where the file is actually read.
        path: "/src/content/site.val.ts",
        patchId,
        patch: [
          { op: "replace", path: ["tagline"], value: "Edited by the probe" },
        ],
      },
    ],
  });
  check(
    "a patch was accepted",
    put.ok,
    `${put.status} ${(await put.text()).slice(0, 200)}`,
  );

  const state = await realFetch(`${CONTENT}/__test__/state`);
  const stateBody = await state.text();
  check(
    "THE CONTENT SERVICE HOLDS THE DRAFT",
    stateBody.includes(patchId),
    `${state.status} ${stateBody.slice(0, 200)}`,
  );

  // --- the publish ----------------------------------------------------------
  const save = await call("/save", "POST", {
    patchIds: [patchId],
    message: "probe",
  });
  const saveBody = await save.text();
  check(
    "the publish succeeded",
    save.ok,
    `${save.status} ${saveBody.slice(0, 200)}`,
  );
  check(
    "...through a real commit",
    events.includes("commit"),
    events.join(" -> "),
  );
  check(
    "...handing the host its files",
    built.length === 1,
    `${built.length} build(s)`,
  );
  check(
    "...AFTER the commit, NOT BEFORE",
    events.indexOf("commit") !== -1 &&
      events.indexOf("build") !== -1 &&
      events.indexOf("commit") < events.indexOf("build"),
    events.join(" -> "),
  );
  check(
    "...at the NEW commit, not the one this build was made from",
    Boolean(built[0]?.commitSha) && built[0]?.commitSha !== BUILT_AT,
    `handed ${built[0]?.commitSha}, built at ${BUILT_AT}`,
  );
  check(
    "...with the patched source",
    (built[0]?.files.length ?? 0) > 0,
    JSON.stringify(built[0]?.files),
  );

  let failed = 0;
  for (const [label, ok, detail] of results) {
    if (!ok) failed += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`,
    );
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
