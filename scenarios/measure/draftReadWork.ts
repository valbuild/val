/**
 * The inputs and the requests of a draft read, with nothing from Node in them.
 *
 * One implementation for both places a draft read is measured: `draftRead.ts`
 * in Node, and the Cloudflare isolate probe (`isolate/worker.ts`), which
 * cannot import `fs`, `child_process` or `v8`. Both generate the same content
 * and send the same requests, through `ValClient`, as a draft-mode `fetchVal`
 * does (`.agent/rules.md`, test rule 3).
 */
import {
  Internal,
  initVal,
  modules as defineModules,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import { PatchId, type ValClient } from "@valbuild/shared/internal";

export type Operation = "load" | "draft" | "draft-novalidate" | "base";
export const OPERATIONS: Operation[] = [
  "load",
  "draft",
  "draft-novalidate",
  "base",
];

/** What each operation is, in the product's terms. */
export const DESCRIBE: Record<Operation, string> = {
  load: "modules loaded and the server answering /stat (the baseline)",
  draft:
    "PUT /sources/~ asking for validation: until phase 6, what a draft-mode fetchVal asked once per request; since, the whole tree from the head, and the flag is ignored",
  "draft-novalidate":
    "the same without validation (until phase 6, previews still computed)",
  base: "PUT /sources/~ unpatched and unvalidated: BaseAlignment's fetch",
};

export const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Inputs

const { s, c, config } = initVal({});

/** The config the synthetic modules are defined with. */
export const syntheticConfig = config;

const item = s.object({
  title: s.string(),
  summary: s.string(),
  body: s.richtext({ bold: true }),
  tags: s.array(s.string()),
});

/** About `megabytes` of content, in 20 record modules of equal size. */
export function synthetic(megabytes: number): {
  modules: ValModule<SelectorSource>[];
  bytes: number;
} {
  const moduleCount = 20;
  const perModule = (megabytes * MB) / moduleCount;
  const sample = entry(0, 0);
  const entryBytes = JSON.stringify(sample).length + 12;
  const entries = Math.max(1, Math.round(perModule / entryBytes));
  const modules: ValModule<SelectorSource>[] = [];
  let bytes = 0;
  for (let m = 0; m < moduleCount; m++) {
    const source: Record<string, ReturnType<typeof entry>> = {};
    for (let i = 0; i < entries; i++) source[`entry-${i}`] = entry(m, i);
    bytes += JSON.stringify(source).length;
    modules.push(c.define(`/content/m${m}.val.ts`, s.record(item), source));
  }
  return { modules, bytes };
}

function entry(m: number, i: number) {
  return {
    title: `Module ${m}, entry ${i}`,
    summary: `A summary of entry ${i} in module ${m}. `.repeat(6),
    body: [
      {
        tag: "p" as const,
        children: [
          `Paragraph one of entry ${i}. `.repeat(4),
          {
            tag: "span" as const,
            styles: ["bold" as const],
            children: ["Bold words"],
          },
        ],
      },
      {
        tag: "p" as const,
        children: [`Paragraph two of entry ${i}. `.repeat(4)],
      },
    ],
    tags: ["alpha", "beta", "gamma"],
  };
}

/** `synth:N` or `synth:N+P`: about N MB, with a chain of P patches. */
export function parseSyntheticInput(
  input: string,
): { megabytes: number; patches: number } | null {
  const match = /^synth:(\d+(?:\.\d+)?)(?:\+(\d+))?$/.exec(input);
  if (match === null) return null;
  const megabytes = Number(match[1]);
  if (!(megabytes > 0)) return null;
  return {
    megabytes,
    patches: match[2] === undefined ? 0 : Number(match[2]),
  };
}

export type LoadedInput = {
  valModules: ValModules;
  bytes: number;
  patches: number;
  /** Where a chain of patches goes: the first module. */
  target: ModuleFilePath | null;
};

/** A `synth:N[+P]` input, as modules a server is started with. */
export function syntheticInput(
  megabytes: number,
  patches: number,
): LoadedInput {
  const { modules, bytes } = synthetic(megabytes);
  return {
    valModules: defineModules(
      config,
      modules.map((module) => ({
        def: () => Promise.resolve({ default: module }),
      })),
    ),
    bytes,
    patches,
    target: moduleFilePathOf(modules[0]),
  };
}

/** The bytes of every module's source, as JSON: what "content" means here. */
export async function contentBytes(valModules: ValModules): Promise<number> {
  let bytes = 0;
  for (const entry of valModules.modules) {
    const module = (await entry.def()).default;
    bytes += JSON.stringify(Internal.getSource(module) ?? null).length;
  }
  return bytes;
}

function moduleFilePathOf(module: ValModule<SelectorSource>): ModuleFilePath {
  const sourcePath = Internal.getValPath(module);
  if (sourcePath === undefined) throw new Error("a module without a path");
  return Internal.splitModuleFilePathAndModulePath(sourcePath)[0];
}

// ---------------------------------------------------------------------------
// Requests

/** `count` patches on `path`, each its own `PUT /patches`, as the Studio saves. */
export async function seedChain(
  client: ValClient,
  count: number,
  path: ModuleFilePath | null,
): Promise<void> {
  if (count === 0 || path === null) return;
  const stat = await client("/stat", "POST", { body: null });
  if (stat.status !== 200 || !("baseSha" in stat.json)) {
    throw new Error(`/stat answered ${stat.status}`);
  }
  for (let i = 0; i < count; i++) {
    const saved = await client("/patches", "PUT", {
      body: {
        parentRef: { type: "head", headBaseSha: stat.json.baseSha },
        patches: [
          {
            path,
            patchId: PatchId.parse(
              `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
            ),
            patch: [
              {
                op: "replace",
                path: [`entry-${i % 50}`, "title"],
                value: `Edit ${i}`,
              },
            ],
          },
        ],
      },
    });
    if (saved.status !== 200) throw new Error(`PUT /patches: ${saved.status}`);
  }
}

export async function runOperation(
  client: ValClient,
  op: Operation,
): Promise<void> {
  if (op === "load") {
    const stat = await client("/stat", "POST", { body: null });
    if (stat.status !== 200) throw new Error(`/stat answered ${stat.status}`);
    return;
  }
  const res = await client("/sources/~", "PUT", {
    path: undefined,
    query:
      op === "base"
        ? {
            apply_patches: false,
            exclude_patches: true,
            validate_sources: false,
            validate_binary_files: false,
          }
        : {
            apply_patches: undefined,
            exclude_patches: undefined,
            validate_sources: op === "draft",
            validate_binary_files: false,
          },
  });
  if (res.status !== 200) {
    throw new Error(`/sources/~ answered ${res.status}`);
  }
}
