import fs from "fs";
import os from "os";
import path from "path";
import { initVal, modules } from "@valbuild/core";
import type { SelectorSource, ValModule } from "@valbuild/core";
import type { RequestScopedMemo } from "@valbuild/shared/internal";
import { createValServer } from "@valbuild/server";
import { encodeJwt } from "@valbuild/server";
import {
  initFetchValStega,
  type DraftSources,
  type GetDraftSourcesScope,
} from "./initValRsc";

/**
 * What a draft render costs, and what the memo takes off it.
 *
 * Not a regression gate — it prints, it does not assert a stopwatch. It exists
 * so the numbers in the reader's comments can be re-derived rather than
 * believed. See `searchIndex.perf.test.ts` for the same arrangement.
 */
describe("draft-mode fetchVal cost", () => {
  const { c, s, config } = initVal();

  const MODULE_COUNT = Number(process.env.PERF_MODULES ?? 20);
  const ENTRIES_PER_MODULE = 40;
  const READS_PER_RENDER = 3;

  const itemSchema = s.object({
    title: s.string(),
    summary: s.string(),
    tags: s.array(s.string()),
  });
  const moduleSchema = s.record(itemSchema);

  function makeSource(seed: number) {
    const out: Record<
      string,
      { title: string; summary: string; tags: string[] }
    > = {};
    for (let i = 0; i < ENTRIES_PER_MODULE; i++) {
      out[`entry-${i}`] = {
        title: `Module ${seed} entry ${i}`,
        summary: `A summary for entry ${i} of module ${seed}. `.repeat(8),
        tags: ["alpha", "beta", "gamma", "delta"],
      };
    }
    return out;
  }

  const modulePaths = Array.from(
    { length: MODULE_COUNT },
    (_, i) => `/content/m${i}.val.ts`,
  );
  const valModuleList: ValModule<SelectorSource>[] = modulePaths.map((p, i) =>
    c.define(p, moduleSchema, makeSource(i)),
  );

  const headers = async () => ({
    get: (name: string) => (name === "host" ? "localhost:3000" : null),
  });
  const cookies = async () => ({
    get: (name: string) => ({ name, value: encodeJwt({}, "") }),
  });

  test("three reads in one render, with and without the per-request memo", async () => {
    const valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-perf-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(valRoot);
    try {
      const valServerPromise = createValServer(
        modules(
          config,
          valModuleList.map((m) => ({
            def: () => Promise.resolve({ default: m }),
          })),
        ),
        "/api/val",
        {},
        config,
        {
          async isEnabled() {
            return true;
          },
          async onDisable() {},
          async onEnable() {},
        },
      );

      /** No request scope: what every read did before the memo. */
      const noScope: GetDraftSourcesScope = async () => null;
      /** One request's scope, shared by the reads in it. */
      const oneRequestScope = (): GetDraftSourcesScope => {
        const box: RequestScopedMemo<DraftSources | null> = {};
        return async () => box;
      };

      const reader = (scope: GetDraftSourcesScope) =>
        initFetchValStega(
          config,
          "/api/val",
          valServerPromise,
          async () => true,
          headers,
          cookies,
          scope,
        );

      const render = async (scope: GetDraftSourcesScope) => {
        const fetchVal = reader(scope);
        const t0 = performance.now();
        await Promise.all(
          Array.from({ length: READS_PER_RENDER }, (_, i) =>
            fetchVal(valModuleList[i % valModuleList.length]),
          ),
        );
        return performance.now() - t0;
      };

      // warm up: the first render of all pays module evaluation
      await render(noScope);

      const REPS = 5;
      const before: number[] = [];
      const after: number[] = [];
      for (let i = 0; i < REPS; i++) {
        before.push(await render(noScope));
        after.push(await render(oneRequestScope()));
      }
      const med = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

      const b = med(before);
      const a = med(after);
      console.log(
        [
          "",
          `modules=${MODULE_COUNT} entriesPerModule=${ENTRIES_PER_MODULE} readsPerRender=${READS_PER_RENDER}`,
          `BEFORE (no memo): ${b.toFixed(1)}ms per render`,
          `AFTER  (memo):    ${a.toFixed(1)}ms per render`,
          `speedup: ${(b / a).toFixed(2)}x`,
          "",
        ].join("\n"),
      );
      expect(a).toBeGreaterThan(0);
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(valRoot, { recursive: true, force: true });
    }
  }, 300000);

  test("narrowing `path` shrinks the answer and not the work", async () => {
    /*
     * The other half of the decision, and the reason the reader still asks for
     * `path: "/"`.
     *
     * `/sources/~` evaluates, previews and validates EVERY module and only then
     * filters the response by `req.path` (the two TODOs in `ValServer.ts` say
     * so). So a narrow path returns a fraction of the object for the same
     * milliseconds — and since `fetchVal` calls the server in process, that
     * object is never serialised or sent anywhere.
     */
    const valRoot = fs.mkdtempSync(path.join(os.tmpdir(), "val-perf-path-"));
    const cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(valRoot);
    try {
      const valServer = await createValServer(
        modules(
          config,
          valModuleList.map((m) => ({
            def: () => Promise.resolve({ default: m }),
          })),
        ),
        "/api/val",
        {},
        config,
        {
          async isEnabled() {
            return true;
          },
          async onDisable() {},
          async onEnable() {},
        },
      );

      const call = async (reqPath: string) => {
        const t0 = performance.now();
        const res = await valServer["/sources/~"]["PUT"]({
          path: reqPath,
          query: {
            validate_sources: true,
            validate_binary_files: false,
            exclude_patches: false,
            apply_patches: undefined,
            patch_id: undefined,
            own_patch_groups_only: true,
          },
          cookies: { val_session: encodeJwt({}, "") },
        });
        const ms = performance.now() - t0;
        if (res.status !== 200) {
          throw new Error(`expected 200 from /sources/~, got ${res.status}`);
        }
        return {
          ms,
          bytes: Buffer.byteLength(JSON.stringify(res.json)),
          count: Object.keys(res.json.modules).length,
        };
      };

      await call("/"); // warm up

      const REPS = 5;
      const whole = [];
      const one = [];
      for (let i = 0; i < REPS; i++) {
        whole.push(await call("/"));
        one.push(await call(modulePaths[3]));
      }
      const med = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

      console.log(
        [
          "",
          `modules=${MODULE_COUNT}`,
          `path="/"                  ${med(whole.map((w) => w.ms)).toFixed(1)}ms  ${whole[0].bytes}B  ${whole[0].count} modules`,
          `path="${modulePaths[3]}"  ${med(one.map((w) => w.ms)).toFixed(1)}ms  ${one[0].bytes}B  ${one[0].count} modules`,
          "",
        ].join("\n"),
      );
      expect(one[0].count).toBe(1);
      expect(whole[0].count).toBe(MODULE_COUNT);
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(valRoot, { recursive: true, force: true });
    }
  }, 300000);
});
