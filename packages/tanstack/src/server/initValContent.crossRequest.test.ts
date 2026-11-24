import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "crypto";
import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { raw } from "@valbuild/react/stega";
import { InMemoryPatchStore } from "@valbuild/server";
import { initValContent, runtimeOfReaders } from "./initValContent";
import { VAL_DRAFT_MODE_COOKIE } from "./valDraftMode";

/**
 * Val's readers on workerd, where one isolate serves many requests and keeps
 * what a module holds between them.
 *
 * A promise there belongs to the request that made it. When that request
 * ends -- the visitor closed the tab -- before the promise settled, it never
 * does, and any other request that awaits it fails with the message below.
 * The readers are made once per process (`initValContent` at module scope),
 * so a promise they KEEP and share is one that a request which has since
 * ended may have made. On Val's hosting a `getHead` server function failed
 * that way, in 4 ms.
 *
 * {@link isolate} is that rule at the edges these readers do not own: the
 * request context (`@tanstack/react-start/server`, which TanStack reads out
 * of async local storage), the bundle's entry imports, and the host's patch
 * store (a Durable Object on Val's hosting). Everything between them --
 * `initValContent`, the runtime, the head, the readers -- is the product's.
 */

const CROSS_REQUEST =
  "This promise was created by a request that has since ended, so it can never settle.";

type FakeRequest = {
  name: string;
  cookies: Record<string, string>;
  ended: boolean;
  /** I/O this request started that has not settled. */
  pending: Set<() => void>;
};

// `mock`-prefixed so the hoisted `jest.mock` factory may close over it.
const mockRequests = new AsyncLocalStorage<FakeRequest>();

// Virtual: jest cannot resolve the package's ESM-only export for itself.
jest.mock(
  "@tanstack/react-start/server",
  () => ({
    getCookie: (name: string): string | undefined =>
      mockRequests.getStore()?.cookies[name],
    getRequestHeaders: () => new Headers({ host: "site.example" }),
  }),
  { virtual: true },
);

/** A workerd isolate, as far as these readers can tell. */
function isolate() {
  let holding = false;
  const held: (() => void)[] = [];
  return {
    /**
     * Run `read` as a request. `end()` ends it with its I/O still under way,
     * as a visitor who leaves does: that I/O never settles for anyone, and a
     * request awaiting it is failed.
     */
    request<T>(
      name: string,
      read: () => Promise<T>,
      cookies: Record<string, string> = {},
    ) {
      const request: FakeRequest = {
        name,
        cookies,
        ended: false,
        pending: new Set(),
      };
      const result = mockRequests.run(request, read);
      // Seen by the test, never unhandled.
      result.catch(() => undefined);
      return {
        result,
        pending: () => request.pending.size,
        end() {
          request.ended = true;
          for (const fail of [...request.pending]) fail();
        },
      };
    },
    /**
     * I/O done for the current request: settles a moment later -- or, while
     * {@link hold} is on, once it is off -- unless its request ended first.
     */
    io<T>(value: () => T | Promise<T>): Promise<T> {
      const owner = mockRequests.getStore();
      return new Promise<T>((resolve, reject) => {
        const settle = () => {
          owner?.pending.delete(fail);
          resolve(value());
        };
        const fail = () => {
          owner?.pending.delete(fail);
          reject(new Error(CROSS_REQUEST));
        };
        owner?.pending.add(fail);
        const later = () =>
          setTimeout(() => {
            if (owner === undefined || !owner.ended) settle();
          }, 1);
        if (holding) held.push(later);
        else later();
      });
    },
    /** Keep every I/O started from now on pending until {@link release}. */
    hold() {
      holding = true;
    },
    release() {
      holding = false;
      for (const later of held.splice(0)) later();
    },
  };
}

/** Until `done`, giving timers and promises a turn each time. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  if (!done()) throw new Error("never happened");
}

const { s, c, config } = initVal();

const PAGE = "/content/page.val.ts" as ModuleFilePath;
const PAGES = "/content/pages.val.ts" as ModuleFilePath;

/**
 * A site, its readers made once for the process as an app makes them, over
 * a patch store whose reads are the current request's I/O.
 */
function site() {
  const workerd = isolate();
  /** The host's store: its reads are I/O of the request that asks. */
  class RequestBoundStore extends InMemoryPatchStore {
    override list() {
      return workerd.io(() => super.list());
    }
  }
  const pageVal = c.define(PAGE, s.object({ title: s.string() }), {
    title: "published",
  });
  const pagesVal = c.define(
    PAGES,
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      "/a": c.json(() => workerd.io(() => ({ default: { title: "Entry A" } }))),
    },
  );
  const valModules: ValModules = {
    config,
    modules: [pageVal, pagesVal].map((module) => ({
      def: async () => ({ default: module }),
    })),
  };
  const readers = initValContent(config, valModules, {
    sourceFiles: {},
    patchStore: new RequestBoundStore(),
    unsafelyAllowUnauthenticated: true,
  });
  const edit = async (path: ModuleFilePath, patch: Patch) => {
    const runtime = runtimeOfReaders(readers.fetchValStega);
    if (runtime === null) throw new Error("the readers have no runtime");
    const ops = (await runtime()).ops;
    await ops.createPatch(
      path,
      patch,
      randomUUID() as PatchId,
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      null,
    );
  };
  const titleOf = async (read: Promise<unknown>) => {
    const value = await read;
    if (typeof value !== "object" || value === null || !("title" in value)) {
      return value;
    }
    return typeof value.title === "string" ? raw(value.title) : value.title;
  };
  return { workerd, readers, pageVal, pagesVal, edit, titleOf };
}

const DRAFT = { [VAL_DRAFT_MODE_COOKIE]: "1" };

test("a visitor's read is not failed by another visitor who left while the same entry was loading", async () => {
  const { workerd, readers, pagesVal, titleOf } = site();
  workerd.hold();
  const a = workerd.request("A", () =>
    titleOf(readers.fetchValKeyStega(pagesVal, "/a")),
  );
  await until(() => a.pending() > 0);
  const b = workerd.request("B", () =>
    titleOf(readers.fetchValKeyStega(pagesVal, "/a")),
  );
  // B has started what it reads, or joined A's.
  await new Promise((resolve) => setTimeout(resolve, 10));
  a.end();
  workerd.release();
  await expect(a.result).rejects.toThrow(CROSS_REQUEST);
  await expect(b.result).resolves.toBe("Entry A");
});

test("an editor's draft read is not failed by another request that left while the chain was being read", async () => {
  const { workerd, readers, pageVal, edit, titleOf } = site();
  await edit(PAGE, [{ op: "replace", path: ["title"], value: "DRAFT" }]);
  workerd.hold();
  const a = workerd.request(
    "A",
    () => titleOf(readers.fetchValStega(pageVal)),
    DRAFT,
  );
  await until(() => a.pending() > 0);
  const b = workerd.request(
    "B",
    () => titleOf(readers.fetchValStega(pageVal)),
    DRAFT,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  a.end();
  workerd.release();
  // A draft that cannot be read is the published page: never an error.
  await expect(a.result).resolves.toBe("published");
  await expect(b.result).resolves.toBe("DRAFT");
});

test("a request that left mid-read leaves nothing behind for the next one", async () => {
  const { workerd, readers, pageVal, pagesVal, edit, titleOf } = site();
  await edit(PAGE, [{ op: "replace", path: ["title"], value: "DRAFT" }]);
  workerd.hold();
  const entry = workerd.request("A", () =>
    titleOf(readers.fetchValKeyStega(pagesVal, "/a")),
  );
  const draft = workerd.request(
    "A2",
    () => titleOf(readers.fetchValStega(pageVal)),
    DRAFT,
  );
  await until(() => entry.pending() > 0 && draft.pending() > 0);
  entry.end();
  draft.end();
  workerd.release();
  await expect(entry.result).rejects.toThrow(CROSS_REQUEST);
  await expect(draft.result).resolves.toBe("published");

  const next = workerd.request(
    "B",
    async () => ({
      entry: await titleOf(readers.fetchValKeyStega(pagesVal, "/a")),
      draft: await titleOf(readers.fetchValStega(pageVal)),
    }),
    DRAFT,
  );
  await expect(next.result).resolves.toEqual({
    entry: "Entry A",
    draft: "DRAFT",
  });
});
