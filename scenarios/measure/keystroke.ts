/**
 * What one write costs in the Studio today, by module size: what a field
 * pays each time typing pauses (`useDebouncedFieldWrite` writes once a pause).
 *
 * Measured through the product's own path: `patchStore.createPatch` (what a
 * field's `useAddPatch` calls), which applies the patch to the module in
 * `SourceStore` -- `applyPatch(deepClone(module))`, the clone the plan's
 * copy-on-write engine is meant to remove.
 *
 * Not a test: it prints. Run from `scenarios/`:
 *
 *   pnpm exec tsx measure/keystroke.ts
 */
import { performance } from "perf_hooks";
import {
  Internal,
  initVal,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import { createSystem } from "../../packages/ui/spa/stores/createSystem";
import { SchemaValidator } from "../../packages/ui/spa/validation/validateModule";

const KB = 1024;
const SIZES_KB = [10, 100, 500, 1024, 2048, 5120];
const KEYSTROKES = 40;

const { s, c } = initVal({});
const item = s.object({ title: s.string(), summary: s.string() });

function moduleOf(bytes: number): ValModule<SelectorSource> {
  const entryBytes = 130;
  const source: Record<string, { title: string; summary: string }> = {};
  const entries = Math.max(1, Math.round(bytes / entryBytes));
  for (let i = 0; i < entries; i++) {
    source[`entry-${i}`] = {
      title: `Entry ${i}`,
      summary: `A summary of entry ${i}. `.repeat(3),
    };
  }
  return c.define("/content/big.val.ts", s.record(item), source);
}

function pathOf(module: ValModule<SelectorSource>): ModuleFilePath {
  const sourcePath = Internal.getValPath(module);
  if (sourcePath === undefined) throw new Error("a module without a path");
  return Internal.splitModuleFilePathAndModulePath(sourcePath)[0];
}

async function measure(sizeKb: number) {
  const module = moduleOf(sizeKb * KB);
  const validator = new SchemaValidator();
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    schemaValidation: {
      validate: async (moduleFilePath, source, serializedSchema, version) =>
        validator.validate(moduleFilePath, source, serializedSchema, version),
    },
  });
  system.host.receive([module]);
  const target = pathOf(module);
  const times: number[] = [];
  let value = "";
  for (let i = 0; i < KEYSTROKES; i++) {
    value += "a";
    const start = performance.now();
    const res = await system.patchStore.createPatch(target, [
      { op: "replace", path: ["entry-7", "title"], value },
    ]);
    times.push(performance.now() - start);
    if (res.status !== "created") throw new Error(res.message);
  }
  system.dispose();
  times.sort((a, b) => a - b);
  return {
    moduleKB: Math.round(
      JSON.stringify(Internal.getSource(module)).length / KB,
    ),
    medianMs: Number(times[Math.floor(times.length / 2)].toFixed(2)),
    p90Ms: Number(times[Math.floor(times.length * 0.9)].toFixed(2)),
  };
}

async function main() {
  const rows = [];
  for (const size of SIZES_KB) rows.push(await measure(size));
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}

void main();
