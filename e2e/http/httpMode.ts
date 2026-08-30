import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { encodeJwt, getExpire } from "../../packages/server/src/jwt";
import {
  HTTP_APP_PORT,
  MOCK_CONTENT_PORT,
  MOCK_PROJECT,
  MOCK_ROOT,
  MOCK_SECRET,
} from "./config";

/**
 * Helpers for the proxy-mode suites: who is editing, and what the content
 * service thinks happened.
 */

/** Long enough for `next dev` to compile the Studio route on the first test. */
const INTAKE_TIMEOUT = 60_000;

const MOCK_BASE = `http://localhost:${MOCK_CONTENT_PORT}`;

/** Which of the mock's two editors a test is acting as. */
export type UserKey = "ada" | "linus";

/**
 * The profile ids of the mock's two editors.
 *
 * These are the `sub` of the session cookie and the `authorId` on every patch, and
 * they have to match the ids in the mock's `/profiles` reply — that is where the
 * Studio gets the name it shows next to a change.
 */
export const USERS: Record<UserKey, { profileId: string }> = {
  ada: { profileId: "profile-ada" },
  linus: { profileId: "profile-linus" },
};

/**
 * A signed `val_session` cookie for one profile.
 *
 * Minted rather than obtained by logging in. `http` mode rejects every request
 * without a session (`getAuth` returns an error unless the cookie decodes), so
 * *something* has to produce one, and the login round-trip goes to
 * admin.val.build — the one part of the product a content-host mock cannot stand
 * in for, and the part that already works.
 *
 * The value is percent-encoded because that is how the real server sets it:
 * `initValServer` writes `encodeURIComponent(cookie.value)` into `Set-Cookie`,
 * and the read side decodes. An HMAC signature is base64, so it routinely
 * contains `+` and `/`; sending it raw decodes to a different string and the
 * session reads as invalid — which the Studio reports as "you will need to login
 * again", pointing nowhere near the cause.
 */
export function sessionCookie(user: UserKey): {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
} {
  const [org, project] = MOCK_PROJECT.split("/");
  const token = encodeJwt(
    {
      sub: USERS[user].profileId,
      exp: getExpire(),
      token: "mock-val-build-token",
      org,
      project,
    },
    MOCK_SECRET,
  );
  return {
    name: "val_session",
    value: encodeURIComponent(token),
    domain: "localhost",
    path: "/",
    // The full shape, because these go through `storageState` as well as
    // `addCookies`, and `storageState` requires every field.
    expires: getExpire(),
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
}

/** A browser context already logged in as one of the two users. */
export async function contextAs(
  browser: Browser,
  user: UserKey,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: `http://localhost:${HTTP_APP_PORT}`,
  });
  await context.addCookies([sessionCookie(user)]);
  return context;
}

/**
 * Open the Studio and wait for it to take the project in.
 *
 * Same wait as the `fs` suites use, but it cannot be shared with them: this one
 * has to tolerate the extra round-trip proxy mode makes before the first `/stat`
 * resolves, and it asserts the mode it got — a test that silently ran against
 * `fs` mode would pass while proving nothing.
 */
export async function openHttpStudio(
  page: Page,
  route = "/val",
): Promise<void> {
  /**
   * Proof that this page really is in proxy mode.
   *
   * The socket exists ONLY in `http` mode — `/stat` answers `use-websocket` there
   * and long-polls in `fs` mode — so a socket to the content host is proof the
   * app is talking to the content service. Without this a misconfigured server
   * would run the whole suite against `fs` mode, passing while proving nothing.
   *
   * Watched on THIS page rather than by counting subscribers on the mock: a
   * socket left open by a previous test would satisfy a count and this would then
   * assert nothing. Registered before `goto`, because the socket opens during
   * intake and a listener added afterwards can miss it.
   */
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));

  /*
   * What the mock had accepted BEFORE this page existed.
   *
   * The page-side check below proves this page opened a socket, but Playwright
   * fires `websocket` when the browser INITIATES one — the mock has not
   * necessarily accepted and registered it yet. Broadcasts only reach sockets
   * already in the mock's set, so a test that fires an event the instant
   * `openHttpStudio` returns can lose it entirely and then sit on "No deploys"
   * until the next `/stat` rescues it. That is a real flake: it took the
   * `deployments.spec.ts` "publish the site is serving is live" test from green
   * to red between two CI runs with no change to `http` mode at all.
   *
   * A count going UP is what distinguishes this page's socket from one an
   * earlier test left open, which a plain `subscribers > 0` could not.
   */
  const acceptedBefore = (await mock.state()).socketsAccepted;

  await page.goto(route);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bag = window as unknown as {
            __VAL_STORES__?: { received: boolean };
          };
          return bag.__VAL_STORES__?.received === true;
        }),
      {
        timeout: INTAKE_TIMEOUT,
        message: "the store system never took the project in",
      },
    )
    .toBe(true);
  await expect
    .poll(() => sockets, {
      timeout: INTAKE_TIMEOUT,
      message: "this page never opened a socket to the content service",
    })
    .toContain(`ws://localhost:${MOCK_CONTENT_PORT}/ws`);
  // And the mock has it, so anything broadcast from here on actually arrives.
  await expect
    .poll(async () => (await mock.state()).socketsAccepted, {
      timeout: INTAKE_TIMEOUT,
      message: "the content service never accepted this page's socket",
    })
    .toBeGreaterThan(acceptedBefore);
}

// #region the mock's control plane

export type MockPatch = {
  patchId: string;
  path: string;
  authorId: string | null;
  applied: { commitSha: string } | null;
  parentPatchId: string | null;
};

/**
 * One uploaded file, and whether it was uploaded as a remote file.
 *
 * Reported separately from the patch it belongs to because the client uploads
 * bytes before it saves the patch — so a test can see the upload without first
 * waiting for the patch to exist.
 */
export type MockPatchFile = {
  patchId: string;
  filePath: string;
  type: "file" | "image";
  remote: boolean;
  bytes: number;
};

export type MockCommit = {
  commitSha: string;
  parentCommitSha: string;
  commitMessage: string | null;
  branch: string;
  creator: string;
  createdAt: string;
};

export type MockDeployment = {
  deploymentId: string;
  commitSha: string;
  deploymentState: string;
  createdAt: string;
  updatedAt: string;
};

export type MockState = {
  patches: MockPatch[];
  patchFiles: MockPatchFile[];
  commits: MockCommit[];
  deployments: MockDeployment[];
  repoOverlay: string[];
  remoteFiles: string[];
  headCommitSha: string;
  subscribers: number;
  /** How many sockets the mock has ever accepted. Only ever increases. */
  socketsAccepted: number;
};

/**
 * One step of a scripted assistant turn.
 *
 * A `tool` step is the interesting one: the mock sends the tool call and waits
 * for the Studio's result, so the whole client-side tool implementation runs
 * before the turn moves on — which is what makes `toolCalls` in {@link MockAiState}
 * an assertion about the product rather than about the script.
 *
 * `arguments` may contain `{{imageKey:0}}`, which the mock replaces with the key
 * of the first image the user attached to the prompt. A test cannot write that
 * key itself: the content service invents it when the browser uploads.
 */
export type AiScriptStep =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name: string;
      arguments?: unknown;
      /** How long to wait for the result. `null` waits indefinitely. */
      timeoutMs?: number | null;
    };

export type AiScript = {
  steps: AiScriptStep[];
  /** The assistant's closing message. */
  response?: string;
};

/** A tool call the scripted assistant made, and what the Studio answered. */
export type MockAiToolCall = {
  name: string;
  arguments: unknown;
  result: unknown;
  isError: boolean;
};

export type MockAiState = {
  prompts: { sessionId: string | null; text: string; imageKeys: string[] }[];
  toolCalls: MockAiToolCall[];
  sessions: { id: string; name: string | null }[];
  images: {
    key: string;
    sessionId: string;
    mimeType: string;
    width: number;
    height: number;
    bytes: number;
  }[];
  queuedScripts: number;
};

async function control<T>(
  action: string,
  init?: { method: "POST"; body?: unknown },
): Promise<T> {
  const res = await fetch(`${MOCK_BASE}/__test__/${action}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
  if (!res.ok) {
    throw new Error(
      `mock control plane ${action} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Everything a test can ask of, or tell, the content service.
 *
 * `deployment` and `pushCommit` are the reason this exists: in production those
 * come from CI, and the Studio only ever learns about them over the WebSocket it
 * opened. There is no editor action that produces one, so a test that wants to
 * see the Studio react has to be able to say it happened.
 */
export const mock = {
  /** Forget every patch, commit, deployment and uploaded file. */
  async reset(): Promise<void> {
    await control("reset", { method: "POST" });
  },

  /** What the content service currently holds. */
  state(): Promise<MockState> {
    return control<MockState>("state");
  },

  /** The text a commit wrote for one module, or null if no commit touched it. */
  async committedSource(moduleFilePath: string): Promise<string | null> {
    const res = await control<{ content: string | null }>(
      `committed-source?path=${encodeURIComponent(`${MOCK_ROOT}${moduleFilePath}`)}`,
    );
    return res.content;
  },

  /**
   * How many bytes a commit wrote at one repo path, or null if it wrote none.
   *
   * For the files there is no text to compare — an image. Asserting that the
   * path appears in the commit is not enough on its own: a commit carrying the
   * wrong bytes puts the path there just the same.
   */
  async committedBytes(repoPath: string): Promise<number | null> {
    const res = await control<{ bytes: number | null }>(
      `committed-source?path=${encodeURIComponent(`${MOCK_ROOT}${repoPath}`)}`,
    );
    return res.bytes;
  },

  /**
   * Announce a deployment, or move an existing one to a new state.
   *
   * `broadcast: false` records it without pushing it down the socket, so the
   * Studio can only learn about it from the next `/stat` — which is how a
   * Studio that was not connected, or was reconnecting, finds out in
   * production.
   */
  deployment(body: {
    commitSha?: string;
    deploymentId?: string;
    deploymentState?: string;
    broadcast?: boolean;
  }): Promise<{ deployment: MockDeployment }> {
    return control<{ deployment: MockDeployment }>("deployment", {
      method: "POST",
      body,
    });
  },

  /** Someone pushed a commit that did not come from the Studio. */
  pushCommit(body?: {
    commitMessage?: string;
    creator?: string;
    branch?: string;
  }): Promise<{ commit: MockCommit }> {
    return control<{ commit: MockCommit }>("commit", {
      method: "POST",
      body: body ?? {},
    });
  },

  /**
   * Queue what the assistant does on its next turn.
   *
   * One script per prompt, in order, so a test that sends two messages queues
   * two. Queue before sending: the mock consumes a script the moment the prompt
   * arrives, and an empty queue answers with a message saying so rather than
   * hanging — a test that forgot to queue then fails on its assertion instead of
   * on a timeout.
   */
  async aiScript(script: AiScript): Promise<void> {
    await control("ai-script", { method: "POST", body: script });
  },

  /** What the assistant was asked, what it called, and what it was answered. */
  aiState(): Promise<MockAiState> {
    return control<MockAiState>("ai-state");
  },

  /**
   * Make `/ai/initialize` fail, or let it succeed again.
   *
   * The studio tries five times before it gives up and reports that the
   * assistant is unavailable, and no editor action can produce that — so a test
   * that wants to see the studio out of options has to say so here.
   */
  async aiOffline(offline: boolean): Promise<void> {
    await control("ai-offline", { method: "POST", body: { offline } });
  },
};

// #endregion

// #region driving the store from the page

/**
 * The system handle the Studio exposes in dev.
 *
 * Typed here rather than imported: `packages/ui` is a browser bundle and these
 * calls are strings evaluated inside the page, so the only contract that matters
 * is the shape at runtime.
 */
type StoreBag = {
  system: {
    patchStore: {
      allRecords(): { patchId: string; appliedAt?: unknown }[];
      createPatch(
        moduleFilePath: string,
        patch: unknown[],
      ): Promise<
        | { status: "created"; record: { patchId: string } }
        | { status: string; message: string }
      >;
    };
    patchSync: {
      flush(): Promise<void>;
      currentParentRef(): {
        type: "head" | "patch";
        patchId?: string;
        headBaseSha?: string;
      } | null;
    };
    sourceStore: { peek(path: string): unknown };
    status: {
      current(): { errors: readonly { message: string; details?: string }[] };
    };
    discard(ids: string[]): Promise<{ status: string; message?: string }>;
    publish(
      patchIds: string[],
      message?: string,
    ): Promise<{ status: string; message?: string }>;
  };
};

/**
 * Make one edit and wait for the server to have it.
 *
 * Driven through the store rather than by typing, for the same reason the `fs`
 * suites do it: this suite is about what happens between the store and the
 * content service, and a text input in between only adds ways to fail that have
 * nothing to do with that.
 */
export async function writePatch(
  page: Page,
  moduleFilePath: string,
  patch: unknown[],
): Promise<string> {
  return page.evaluate(
    async ({ mfp, ops }) => {
      const bag = window as unknown as { __VAL_STORES__: StoreBag };
      const system = bag.__VAL_STORES__.system;
      const res = await system.patchStore.createPatch(mfp, ops);
      // `in` rather than a status check: the failure branch types `status` as a
      // plain `string`, which overlaps `"created"`, so TypeScript cannot narrow.
      if (!("record" in res)) {
        throw new Error(`createPatch failed: ${JSON.stringify(res)}`);
      }
      await system.patchSync.flush();
      return res.record.patchId;
    },
    { mfp: moduleFilePath, ops: patch },
  );
}

/**
 * Make one edit and report the outcome instead of waiting for it to succeed.
 *
 * {@link writePatch} is the happy path and throws on anything else, which is
 * right for a test whose subject is somewhere after the write. A test whose
 * subject IS the write needs to see the failure rather than be thrown out of, so
 * this returns the id and leaves the assertion to the caller: a patch the server
 * refused is dropped from the store by the time `flush` resolves, so "is this id
 * still in the chain" is the question that distinguishes saved from lost.
 */
export async function tryWritePatch(
  page: Page,
  moduleFilePath: string,
  patch: unknown[],
): Promise<{ patchId: string; keptLocally: boolean }> {
  return page.evaluate(
    async ({ mfp, ops }) => {
      const bag = window as unknown as { __VAL_STORES__: StoreBag };
      const system = bag.__VAL_STORES__.system;
      const res = await system.patchStore.createPatch(mfp, ops);
      if (!("record" in res)) {
        throw new Error(`createPatch failed: ${JSON.stringify(res)}`);
      }
      const patchId = res.record.patchId;
      await system.patchSync.flush();
      return {
        patchId,
        keptLocally: system.patchStore
          .allRecords()
          .some((record) => record.patchId === patchId),
      };
    },
    { mfp: moduleFilePath, ops: patch },
  );
}

/**
 * What the next write would name as its parent.
 *
 * The one piece of client state this suite asserts on directly, because it is
 * the cause and everything else is the symptom: a parent naming a patch the
 * content service no longer has is what turns the next edit into a lost one.
 */
export function currentParentRef(page: Page): Promise<{
  type: "head" | "patch";
  patchId?: string;
  headBaseSha?: string;
} | null> {
  return page.evaluate(() => {
    const bag = window as unknown as { __VAL_STORES__: StoreBag };
    return bag.__VAL_STORES__.system.patchSync.currentParentRef();
  });
}

/**
 * Everything the Studio has told the editor is wrong.
 *
 * Read from `StatusStore` rather than off the screen. The words are the same
 * either way — this is what the toast renders — and reading them here means a
 * test about saving does not also depend on where the notice is drawn or how
 * long it stays up.
 */
export function reportedErrors(
  page: Page,
): Promise<{ message: string; details?: string }[]> {
  return page.evaluate(() => {
    const bag = window as unknown as { __VAL_STORES__: StoreBag };
    return bag.__VAL_STORES__.system.status.current().errors.map((error) => ({
      message: error.message,
      details: error.details,
    }));
  });
}

/** What the page currently shows at one source path. */
export function peek(page: Page, sourcePath: string): Promise<unknown> {
  return page.evaluate((path) => {
    const bag = window as unknown as { __VAL_STORES__: StoreBag };
    return bag.__VAL_STORES__.system.sourceStore.peek(path);
  }, sourcePath);
}

/** How many patches the page's own store holds. */
export function chainLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bag = window as unknown as { __VAL_STORES__?: StoreBag };
    return bag.__VAL_STORES__?.system.patchStore.allRecords().length ?? 0;
  });
}

/**
 * Publish everything the page currently holds, and return what the seam said.
 *
 * Driven through the system rather than by clicking Publish so a failure reads as
 * a failure of the publish path, not of whatever the button was disabled by.
 */
export function publishAll(
  page: Page,
  message?: string,
): Promise<{ status: string; message?: string }> {
  return page.evaluate(async (commitMessage) => {
    const bag = window as unknown as { __VAL_STORES__: StoreBag };
    const system = bag.__VAL_STORES__.system;
    const ids = system.patchStore.allRecords().map((record) => record.patchId);
    return system.publish(ids, commitMessage);
  }, message);
}

/** Throw away every patch the page holds. */
export async function discardAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bag = window as unknown as { __VAL_STORES__: StoreBag };
    const system = bag.__VAL_STORES__.system;
    const ids = system.patchStore.allRecords().map((record) => record.patchId);
    if (ids.length === 0) return;
    const res = await system.discard(ids);
    if (res.status !== "discarded") {
      throw new Error(`could not discard: ${res.message ?? res.status}`);
    }
  });
}

// #endregion
