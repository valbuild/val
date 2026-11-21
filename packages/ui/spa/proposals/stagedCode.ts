import type { ModuleFilePath, ValModules } from "@valbuild/core";
import type { Evaluated } from "@valbuild/shared/internal";
import type { CodeReload, HostStore } from "../stores/HostStore";
import { registryOfEntry } from "../stores/react/loadValModules";
import type { ProjectSnapshot } from "./projectSnapshot";

/**
 * After a staging, the tab evaluates the proposal's `val.modules` and swaps
 * the schema in (`docs/plans/one-content-model.md`, "Evaluating code after a
 * write"). Without it a field the assistant adds exists nowhere until the
 * proposal is built: the Studio cannot show it, the editor cannot type into
 * it, and a `.val.ts` that throws is found out by a build that fails minutes
 * later -- or by a Studio that silently shows the old fields.
 *
 * 1. **Bundle** `val.modules.ts` and what it imports, from the site's source
 *    with the proposal's files over it (`bundleValModules`). Routes and
 *    components are not part of it: a broken component does not stop it.
 * 2. **Evaluate it off the Studio's page** first (`evaluateTree`: a worker,
 *    with a deadline). Code that throws or never finishes costs a worker, not
 *    the Studio -- and the Studio is what the assistant fixes it from.
 * 3. **Import it here and reload the code** (`HostStore.reloadCode`), which
 *    touches only the modules whose schema moved, and holds -- never deletes
 *    -- an edit the code moved under.
 * 4. **Say what happened**, for the assistant: the modules whose schema
 *    moved, the ones that went, the ones whose content does not fit their
 *    new schema, or why the code did not evaluate.
 *
 * Bundling needs a page that can run the builder (`canBuildHere`). Where it
 * cannot, nothing is evaluated and the answer says so: the proposal's build
 * is then how the schema arrives, as before.
 */
export type StagedCodeOutcome =
  | {
      status: "swapped";
      /** What a build of the staged files is named for, when there is one. */
      inputs: string | null;
      /** The modules whose schema moved, or that are new. */
      changed: ModuleFilePath[];
      /** The modules no longer in `val.modules`. */
      removed: ModuleFilePath[];
      /** Modules whose content does not fit their (new) schema, and why. */
      invalid: { moduleFilePath: ModuleFilePath; errors: string[] }[];
      /**
       * The project files the bundle was made of: `val.modules.ts` and what
       * it reaches. A write of none of them cannot change the outcome
       * ({@link stagedCodeReach}). Absent where the bundler did not say.
       */
      reads?: string[];
    }
  | {
      /** The staged code does not bundle or does not run: nothing moved. */
      status: "does-not-evaluate";
      inputs: string | null;
      message: string;
    }
  | {
      /** This page cannot run the builder: nothing was evaluated. */
      status: "not-here";
    };

export type StagedCodeDeps = {
  /**
   * The proposal's project as the staging left it -- the site's source with
   * the proposal's files over it (`proposalProject`) -- and the staged inputs.
   */
  project: () => Promise<{
    files: Record<string, string>;
    inputs: string | null;
  }>;
  /** `bundleValModules`, against the site's vendor layer; `null` where this page cannot run the builder. */
  bundle:
    | ((files: Record<string, string>) => Promise<{
        code: string;
        /** Each module file, and the project files it depends on. */
        dependencies?: Record<string, string[]>;
      }>)
    | null;
  /** Off the Studio's page, with a deadline: `evaluateTree`. */
  evaluate: (code: string) => Promise<Evaluated>;
  /** The same bundle, imported in the Studio's own realm: its default export. */
  importRegistry: (code: string) => Promise<ValModules>;
  /** `HostStore.reloadCode`. */
  reloadCode: (registry: ValModules) => Promise<CodeReload>;
};

/** Errors per module handed to the model at once. */
const MAX_ERRORS_PER_MODULE = 10;

export async function evaluateStagedCode(
  deps: StagedCodeDeps,
): Promise<StagedCodeOutcome> {
  const bundle = deps.bundle;
  if (bundle === null) return { status: "not-here" };
  const { files, inputs } = await deps.project();
  const failed = (message: string): StagedCodeOutcome => ({
    status: "does-not-evaluate",
    inputs,
    message,
  });
  let code: string;
  let reads: string[] | undefined;
  try {
    const bundled = await bundle(files);
    code = bundled.code;
    reads =
      bundled.dependencies === undefined
        ? undefined
        : bundleReads(files, bundled.dependencies);
  } catch (error) {
    return failed(messageOf(error));
  }
  let evaluated: Evaluated;
  try {
    evaluated = await deps.evaluate(code);
  } catch (error) {
    return failed(messageOf(error));
  }
  let registry: ValModules;
  try {
    registry = await deps.importRegistry(code);
  } catch (error) {
    return failed(messageOf(error));
  }
  const reload = await deps.reloadCode(registry);
  if (reload.status === "kept") {
    return failed(
      reload.reason === "does-not-load"
        ? reload.details
        : "Newer code arrived while this was read; it is the one the Studio runs.",
    );
  }
  const invalid: { moduleFilePath: ModuleFilePath; errors: string[] }[] = [];
  for (const moduleFilePath of reload.changed) {
    const errors = evaluated[moduleFilePath]?.errors ?? [];
    if (errors.length === 0) continue;
    invalid.push({
      moduleFilePath,
      errors: errors
        .slice(0, MAX_ERRORS_PER_MODULE)
        .map((error) =>
          error.path.length === 0
            ? error.message
            : `${error.path.join(".")}: ${error.message}`,
        ),
    });
  }
  return {
    status: "swapped",
    inputs,
    changed: reload.changed,
    removed: reload.removed,
    invalid,
    ...(reads !== undefined ? { reads } : {}),
  };
}

/** The entry, every module file it reaches and every file those depend on. */
function bundleReads(
  files: Record<string, string>,
  dependencies: Record<string, string[]>,
): string[] {
  const reads = new Set<string>(
    VAL_MODULES_ENTRIES.filter((path) => path in files),
  );
  for (const [module, deps] of Object.entries(dependencies)) {
    reads.add(module);
    for (const path of deps) reads.add(path);
  }
  return [...reads].sort();
}

const VAL_MODULES_ENTRIES = ["val.modules.ts", "val.modules.js"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the assistant is told of an evaluation: with `write_files`' answer
 * when it finished in time, else with its next tool answer.
 */
export function stagedCodeNotice(outcome: StagedCodeOutcome): unknown {
  switch (outcome.status) {
    case "swapped":
      return {
        status: "evaluated",
        schemaChanged: outcome.changed,
        ...(outcome.removed.length > 0 ? { removed: outcome.removed } : {}),
        ...(outcome.invalid.length > 0
          ? {
              contentErrors: outcome.invalid,
              next: "These modules' content does not fit their new schema: fix the content in the .val.ts, or the schema.",
            }
          : outcome.changed.length > 0
            ? {
                next: "The Studio has the new schema: its fields can be edited now, before a build.",
              }
            : {}),
      };
    case "does-not-evaluate":
      return {
        status: "does-not-evaluate",
        error: outcome.message,
        next: "val.modules.ts, or a .val.ts it imports, does not run. The Studio keeps the schema it had. Fix it before you build.",
      };
    case "not-here":
      return {
        status: "not-evaluated",
        note: "This page cannot run the builder, so the Studio gets the new schema when the proposal is built.",
      };
  }
}

/**
 * Import a bundle's code in this realm: what `evaluateTree.worker.ts` does
 * off the page, here, once the worker has shown it loads.
 */
export async function importBundle(code: string): Promise<ValModules> {
  const url = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  try {
    return registryOfEntry(await import(/* @vite-ignore */ url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The evaluations of one proposal's staged code, one after another: each
 * staging is evaluated after the one before it, so the last to finish is of
 * the last staging, and an older registry never lands over a newer one.
 *
 * At most one waits behind the one running: an evaluation reads the project
 * when it STARTS, so the one waiting is already of every staging made until
 * then, and three writes in one reply are evaluated twice at most rather
 * than three times end to end.
 */
type Lane = {
  running: Promise<StagedCodeOutcome> | null;
  next: Promise<StagedCodeOutcome> | null;
};
const lanes = new Map<string, Lane>();
/** The last outcome, and whether the assistant has been told of it. */
let latest: { name: string; outcome: StagedCodeOutcome } | null = null;
const told = new WeakSet<StagedCodeOutcome>();

/**
 * Evaluate proposal `name`'s staged code, after any evaluation of it already
 * running; joined, when one is waiting to run already.
 */
export function runStagedCode(
  name: string,
  deps: StagedCodeDeps,
): Promise<StagedCodeOutcome> {
  let lane = lanes.get(name);
  if (lane === undefined) {
    lane = { running: null, next: null };
    lanes.set(name, lane);
  }
  if (lane.next !== null) return lane.next;
  const own = lane;
  const evaluate = async (): Promise<StagedCodeOutcome> => {
    let outcome: StagedCodeOutcome;
    try {
      outcome = await evaluateStagedCode(deps);
    } catch (error) {
      outcome = {
        status: "does-not-evaluate",
        inputs: null,
        message: messageOf(error),
      };
    }
    // Not when the lanes were reset meanwhile (a test's `resetStagedCode`).
    if (lanes.get(name) === own) latest = { name, outcome };
    return outcome;
  };
  const before = own.running;
  const done: Promise<StagedCodeOutcome> = (
    before === null
      ? evaluate()
      : // `evaluate` answers its own failures, so `before` never rejects.
        before.then(() => {
          own.next = null;
          own.running = done;
          return evaluate();
        })
  ).finally(() => {
    if (own.running === done) own.running = null;
  });
  if (before === null) own.running = done;
  else own.next = done;
  return done;
}

/**
 * Whether a write of `paths` in proposal `name` can change what evaluating
 * its staged code finds:
 *
 * - `can`: a Val file (a `.val.ts`, its `.val.json` entries, `val.modules`,
 *   `val.config`), a file the last evaluation's bundle was made of, or any
 *   file while the staged code does not evaluate -- the fix may be anywhere.
 *   The write waits for the evaluation.
 * - `may`: not known -- nothing was evaluated in this tab yet, one is under
 *   way whose bundle may reach further than the last one's, or the write is
 *   of what decides how imports resolve. It is evaluated, and the write does
 *   not wait: what it finds reaches the assistant with its next tool answer
 *   ({@link untoldStagedCode}).
 * - `cannot`: no file the bundle reads. Nothing is evaluated.
 */
export type StagedCodeReach = "can" | "may" | "cannot";

export function stagedCodeReach(
  name: string,
  paths: string[],
): StagedCodeReach {
  const written = paths.map((path) => path.replace(/^\/+/, ""));
  if (written.some(isValFile)) return "can";
  const lane = lanes.get(name);
  if (lane !== undefined && (lane.running !== null || lane.next !== null)) {
    return "may";
  }
  const last = latest !== null && latest.name === name ? latest.outcome : null;
  if (last === null) return "may";
  switch (last.status) {
    case "not-here":
      // Nothing is evaluated on this page, whatever is written.
      return "cannot";
    case "does-not-evaluate":
      return "can";
    case "swapped": {
      if (last.reads === undefined) return "may";
      const reads = new Set(last.reads);
      if (written.some((path) => reads.has(path))) return "can";
      return written.some(decidesResolution) ? "may" : "cannot";
    }
  }
}

function isValFile(path: string): boolean {
  return (
    /\.val\.(ts|js|json)$/.test(path) ||
    /(^|\/)val\.(modules|config)\.(ts|js)$/.test(path)
  );
}

/** A file that decides which file an import names. */
function decidesResolution(path: string): boolean {
  return /(^|\/)(package|tsconfig[^/]*|jsconfig[^/]*)\.json$/.test(path);
}

/**
 * The last evaluation of proposal `name`, if the assistant has not been told
 * of it: it hears on its next tool answer. Only one that has something to
 * say -- a schema that moved, content that does not fit, code that does not
 * run.
 */
export function untoldStagedCode(name: string): StagedCodeOutcome | null {
  if (latest === null || latest.name !== name) return null;
  const outcome = latest.outcome;
  if (told.has(outcome) || !worthTelling(outcome)) return null;
  return outcome;
}

export function markStagedCodeTold(outcome: StagedCodeOutcome): void {
  told.add(outcome);
}

function worthTelling(outcome: StagedCodeOutcome): boolean {
  switch (outcome.status) {
    case "swapped":
      return (
        outcome.changed.length > 0 ||
        outcome.removed.length > 0 ||
        outcome.invalid.length > 0
      );
    case "does-not-evaluate":
      return true;
    case "not-here":
      return false;
  }
}

/** For tests: nothing evaluated. */
export function resetStagedCode(): void {
  lanes.clear();
  latest = null;
}

/**
 * `StagedCodeDeps.project`: the proposal's project as the chat's snapshot
 * holds it (`projectSnapshot.ts`) -- this tab's staging laid over it, so
 * asked for again only when that staging left it in doubt -- and the inputs
 * a build of it is named for.
 */
export function stagedProject(
  name: string,
  snapshot: Pick<ProjectSnapshot, "read">,
): StagedCodeDeps["project"] {
  return async () => {
    const { project, staged } = await snapshot.read(name);
    return { files: project, inputs: staged?.inputs ?? null };
  };
}

/**
 * `StagedCodeDeps.reloadCode`: every instance of an imported bundle is new,
 * so modules are compared by content, and only what moved moves.
 */
export function reloadStaged(
  host: Pick<HostStore, "reloadCode">,
): StagedCodeDeps["reloadCode"] {
  return (registry) => host.reloadCode(registry, { byContent: true });
}
