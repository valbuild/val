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

  /** Announce a deployment, or move an existing one to a new state. */
  deployment(body: {
    commitSha?: string;
    deploymentId?: string;
    deploymentState?: string;
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
    patchSync: { flush(): Promise<void> };
    sourceStore: { peek(path: string): unknown };
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
