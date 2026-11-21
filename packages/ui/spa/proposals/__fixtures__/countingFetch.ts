import type { ProposalJson, ProposalStaged } from "../proposalsClient";

/**
 * The Studio's requests to its own origin, counted: the network is the edge
 * the counting tests fake (`codeToolRequests.test.ts`,
 * `afterStagingRequests.test.tsx`). It answers as content does through Val's
 * relay for one proposal with code staged, and remembers every request it
 * was sent, so a test states how many a piece of the product made.
 *
 * A request to a route it does not know throws: a new request is a count
 * someone has to write down.
 */
export const NAME = "0123456789abcdef0123";
export const SITE: Record<string, string> = {
  "src/components/Hero.tsx": "export const Hero = () => <h1>Hello</h1>;\n",
  "src/app.tsx": "export const App = () => null;\n",
};

export type CountedRequest = {
  method: string;
  /** Below `/api/val`, with the proposal's name as `:name`. */
  route: string;
  /** A read content answered "not modified": asked, but nothing sent back. */
  notModified: boolean;
};

export type CountingFetch = {
  requests: CountedRequest[];
  /** The requests so far, as `METHOD route` lines, and forget them. */
  take(): string[];
  restore(): void;
};

const SOURCE_ETAG = '"site-source-1"';
const TARGET = {
  base: {
    rev: "set-0123456789abcdef01234567",
    shellRev: "s",
    rscShellRev: "r",
    modules: {},
    rscModules: {},
    paths: {
      baseFromProject: "../vendor",
      projectVendorDir: "pvendor",
      rscVendorBase: "rsc",
      rscRuntimeSpecifier: "rsc",
      rscRuntimePath: "rsc",
      flightServer: "flight",
      serverFnBase: "/_serverFn",
    },
  },
  project: {
    rev: "site-layer",
    rsc: false,
    modules: {},
    css: {},
    workerOnly: [],
  },
};

export function installCountingFetch(): CountingFetch {
  const requests: CountedRequest[] = [];
  const own: Record<string, string | null> = {};
  let stagings = 0;
  const staged = (): ProposalStaged => ({
    files: Object.keys(own).sort(),
    inputs: stagings === 0 ? null : `inputs-${stagings}`,
    buildRequired: stagings > 0,
  });
  const proposal = (): ProposalJson => ({
    name: NAME,
    branch: `val/p/${NAME}`,
    displayName: "Spring",
    status: "open",
    updatedAt: "2026-11-21T10:00:00.000Z",
    codeMode: { on: true, changedBy: "ada", changedAt: null },
    staged: staged(),
  });

  const answer = (
    method: string,
    route: string,
    headers: Headers,
    body: unknown,
  ): { status: number; body?: unknown; etag?: string } => {
    switch (`${method} ${route}`) {
      case "GET /proposals-api":
        return { status: 200, body: { proposals: [proposal()] } };
      case "GET /proposals-api/:name":
        return { status: 200, body: { proposal: proposal() } };
      case "GET /proposals-api/:name/files":
        return { status: 200, body: { files: own, staged: staged() } };
      case "POST /proposals-api/:name/files": {
        const files =
          typeof body === "object" && body !== null && "files" in body
            ? body.files
            : {};
        for (const [path, text] of Object.entries(files ?? {})) {
          own[path] = typeof text === "string" ? text : null;
        }
        stagings += 1;
        return {
          status: 200,
          // `savedFirst` is Val's relay's: nothing was pending to save.
          body: {
            commit: `commit-${stagings}`,
            staged: staged(),
            savedFirst: false,
          },
        };
      }
      case "POST /proposals-api/:name/quick-preview":
        return {
          status: 200,
          body: {
            inputs: staged().inputs,
            files: {
              "/_app/app.js": { body: "app", contentType: "text/javascript" },
            },
          },
        };
      case "GET /publish-api/project-source":
        return headers.get("if-none-match") === SOURCE_ETAG
          ? { status: 304 }
          : { status: 200, body: { files: SITE }, etag: SOURCE_ETAG };
      case "GET /publish-api/build-target":
        return { status: 200, body: TARGET };
      default:
        throw new Error(
          `The counting fetch has no answer for ${method} ${route}: a request nobody has counted.`,
        );
    }
  };

  const bag: { fetch?: unknown } = globalThis;
  const before = bag.fetch;
  // The part of a `Response` the Studio's clients read: jsdom has no
  // `Response` to make a whole one with.
  bag.fetch = async (
    input: unknown,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    const method = init?.method ?? "GET";
    const path = String(input).split("?")[0] ?? "";
    if (!path.startsWith("/api/val/")) {
      throw new Error(`A request outside Val's API: ${method} ${path}`);
    }
    const route = path.slice("/api/val".length).replace(`/${NAME}`, "/:name");
    const answered = answer(
      method,
      route,
      new Headers(init?.headers ?? {}),
      init?.body === undefined ? undefined : JSON.parse(init.body),
    );
    requests.push({ method, route, notModified: answered.status === 304 });
    return {
      ok: answered.status >= 200 && answered.status < 300,
      status: answered.status,
      statusText: "",
      headers: new Headers(
        answered.etag !== undefined ? { etag: answered.etag } : {},
      ),
      text: async () =>
        answered.body === undefined ? "" : JSON.stringify(answered.body),
    };
  };
  return {
    requests,
    take: () =>
      requests.splice(0).map((each) => `${each.method} ${each.route}`),
    restore: () => {
      bag.fetch = before;
    },
  };
}
