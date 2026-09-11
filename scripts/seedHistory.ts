/**
 * A published history to look at, for working on the history and restore UX.
 *
 * The proxy-mode stack comes up with an empty commit list, and the History pane
 * with nothing in it says nothing about the design. Getting past that by hand
 * means editing and publishing several times before the screen under test even
 * appears, every time the mock content host restarts — which it does on every
 * `dev:example-next:http`.
 *
 * ## Through the app, not into the mock
 *
 * Every commit here is made by `PUT /api/val/patches` followed by
 * `POST /api/val/save`, which is the same path the Studio's Publish button
 * takes: `ValOpsHttp.commit` computes each changed module's data and the schema
 * it was under, and the content host archives what it is sent. Writing archives
 * straight into the mock's control plane would be faster and would seed a shape
 * the product never produces — so the UX would be designed against fiction, and
 * the first real publish would disagree with it.
 *
 * The cost of that choice is that a scenario is only as valid as the example
 * project: a patch naming a path that has since moved is refused. That is
 * reported per scenario and does not stop the rest — a partially seeded history
 * is still worth looking at, and a hard failure here would take the whole dev
 * stack down with it.
 */
import {
  HTTP_APP_PORT,
  MOCK_CONTENT_PORT,
  MOCK_PROJECT,
  MOCK_SECRET,
} from "../e2e/http/config";
import { encodeJwt, getExpire } from "../packages/server/src/jwt";

const APP = `http://localhost:${HTTP_APP_PORT}`;
const MOCK = `http://localhost:${MOCK_CONTENT_PORT}`;

/**
 * Which editor a commit is attributed to.
 *
 * The author on a commit is `auth.id` from the session cookie the `/save` call
 * carries, not anything in its body — so a history where every commit is by the
 * same person is the only one a single cookie can produce, and "who changed
 * this" is part of what the pane has to show.
 */
type Editor = "ada" | "linus";

function cookieFor(editor: Editor): string {
  const [org, project] = MOCK_PROJECT.split("/");
  const token = encodeJwt(
    {
      sub: `profile-${editor}`,
      exp: getExpire(),
      token: "mock-val-build-token",
      org,
      project,
    },
    MOCK_SECRET,
  );
  return `val_session=${encodeURIComponent(token)}`;
}

type PatchOp = {
  op: "replace" | "add" | "remove";
  path: string[];
  value?: unknown;
};

/** One publish: the modules it changes, who makes it, and what it is called. */
type Scenario = {
  message: string;
  editor: Editor;
  /** Why this shape is in the seed, printed when it cannot be applied. */
  covers: string;
  edits: { module: string; patch: PatchOp[] }[];
};

/**
 * The commits the seed makes, oldest first.
 *
 * Chosen for the states the restore UI has to handle rather than for coverage
 * of the example project: a scalar, an array (whose items splice, which is what
 * directed restore exists for), a commit spanning two modules, rich text, and a
 * commit by somebody else. `devProxyMode` adds one more after these that no
 * publish can produce — a commit with no archive.
 */
const SCENARIOS: Scenario[] = [
  {
    message: "Lighten the brand colour",
    editor: "ada",
    covers: "one scalar field — the simplest thing a restore can put back",
    edits: [
      {
        module: "/content/theme.val.ts",
        patch: [
          {
            op: "replace",
            path: ["brand"],
            value: "hsl(262.1 83.3% 57.8%)",
          },
        ],
      },
    ],
  },
  {
    message: "Reword the keyword list",
    editor: "ada",
    covers:
      "an array, whose items splice — the case directed restore was built for",
    edits: [
      {
        module: "/content/lists.val.ts",
        patch: [
          {
            op: "replace",
            path: ["keywords"],
            value: ["editing", "preview", "publish", "history", "restore"],
          },
        ],
      },
    ],
  },
  {
    message: "Rename an author and retint the accent",
    editor: "linus",
    covers:
      "two modules in one commit — whole-module restore without the rest of it",
    edits: [
      {
        module: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["teddy", "name"],
            value: "Theodor R. Carlsen",
          },
        ],
      },
      {
        module: "/content/theme.val.ts",
        patch: [
          { op: "replace", path: ["accent"], value: "oklch(0.72 0.19 32)" },
        ],
      },
    ],
  },
  {
    message: "Tighten the onboarding summary",
    editor: "ada",
    covers:
      "a nested field inside an array item — a deep path on the right pane",
    edits: [
      {
        module: "/content/handbook.val.ts",
        patch: [
          {
            op: "replace",
            path: ["0", "summary"],
            value:
              "Write the exception down somewhere findable, or it did not happen.",
          },
        ],
      },
    ],
  },
];

type ParentRef =
  | { type: "head"; headBaseSha: string }
  | { type: "patch"; patchId: string };

/**
 * What the next patch has to name as its parent.
 *
 * Not simply `head`, and this is the one thing about proxy mode a seed script
 * has to know: publishing there marks patches APPLIED rather than deleting
 * them, so they stay in the chain and the head of it is the last patch, not the
 * commit. Naming `head` after the first publish is answered with a 409 whose
 * message — "written against a different starting point" — reads as a conflict
 * with another editor.
 *
 * `body: null` asks for the state right now rather than long-polling for a
 * change, which is the same call the Studio makes when it needs to resync.
 */
async function currentParentRef(cookie: string): Promise<ParentRef> {
  const res = await fetch(`${APP}/api/val/stat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: "null",
  });
  if (!res.ok) {
    throw new Error(`/stat answered ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    baseSha?: string;
    patches?: string[];
  };
  const patches = body.patches ?? [];
  const last = patches[patches.length - 1];
  if (last !== undefined) {
    return { type: "patch", patchId: last };
  }
  if (typeof body.baseSha !== "string") {
    throw new Error(
      `/stat answered without a baseSha: ${JSON.stringify(body)}`,
    );
  }
  return { type: "head", headBaseSha: body.baseSha };
}

/**
 * Apply one scenario and publish it.
 *
 * Every patch in a scenario goes in one `PUT`, so the parent chain is the
 * server's problem rather than this script's: a second `PUT` would have to name
 * the first patch as its parent, and getting that wrong is answered with a 409
 * that reads like a conflict with another editor.
 */
async function publishScenario(
  scenario: Scenario,
  index: number,
): Promise<{ ok: true; commitSha: string } | { ok: false; why: string }> {
  const cookie = cookieFor(scenario.editor);
  const parentRef = await currentParentRef(cookie);
  const patchIds = scenario.edits.map(
    (_, editIndex) => `seed-${index}-${editIndex}`,
  );
  const putRes = await fetch(`${APP}/api/val/patches`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      parentRef,
      patches: scenario.edits.map((edit, editIndex) => ({
        path: edit.module,
        patchId: patchIds[editIndex],
        patch: edit.patch,
      })),
    }),
  });
  if (!putRes.ok) {
    return { ok: false, why: `patches: ${await putRes.text()}` };
  }
  const saveRes = await fetch(`${APP}/api/val/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ patchIds, message: scenario.message }),
  });
  if (!saveRes.ok) {
    return { ok: false, why: `save: ${await saveRes.text()}` };
  }
  const body = (await saveRes.json()) as { commitSha?: string };
  return { ok: true, commitSha: body.commitSha ?? "(unreported)" };
}

/** A commit Val did not make, so the pane has one it cannot open. */
async function pushForeignCommit(): Promise<boolean> {
  const res = await fetch(`${MOCK}/__test__/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commitMessage: "Fix a typo in the footer (pushed from CI)",
      creator: "some-colleague",
    }),
  });
  return res.ok;
}

export async function seedHistory(): Promise<void> {
  console.log("[seed] publishing a history to look at");
  for (const [index, scenario] of SCENARIOS.entries()) {
    const outcome = await publishScenario(scenario, index);
    if (outcome.ok) {
      console.log(`[seed] ✓ ${scenario.message}`);
    } else {
      // Loud, but not fatal: the rest of the history is still worth having, and
      // the usual cause is that the example project moved under a hard-coded
      // path — which the reader can only act on if they are told which one.
      console.warn(
        `[seed] ✗ ${scenario.message}\n` +
          `        covers: ${scenario.covers}\n` +
          `        ${outcome.why}`,
      );
    }
  }
  if (await pushForeignCommit()) {
    console.log("[seed] ✓ a commit pushed outside Val, with no archive");
  } else {
    console.warn("[seed] ✗ could not push a commit through the mock");
  }
}

/**
 * Run directly (`pnpm run seed:history`) as well as from `devProxyMode`.
 *
 * Re-seeding a stack that is already up is the common case: the mock holds its
 * commits in memory, so restarting it — or wanting a different set of shapes
 * after editing `SCENARIOS` — is a reason to run this again without restarting
 * Next and Vite.
 */
if (process.argv[1]?.endsWith("seedHistory.ts")) {
  seedHistory().catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  });
}
