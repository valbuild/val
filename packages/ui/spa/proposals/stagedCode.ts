import type { ModuleFilePath, ValModules } from "@valbuild/core";
import type { Evaluated } from "@valbuild/shared/internal";
import { proposalProject } from "@valbuild/shared/publish";
import type { CodeReload, HostStore } from "../stores/HostStore";
import type { ProposalsClient } from "./proposalsClient";

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
  bundle: ((files: Record<string, string>) => Promise<{ code: string }>) | null;
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
  try {
    code = (await bundle(files)).code;
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
  };
}

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
 * The Val modules bundle, read in this realm: `val.modules.ts`'s default
 * export, `modules(config, [...])`. The modules it makes come from the
 * site's copy of `@valbuild/core`; the Studio reads them with its own, which
 * works because their symbols are `Symbol.for` (`isValModule`).
 */
export function registryOfEntry(entry: unknown): ValModules {
  const registry =
    typeof entry === "object" && entry !== null && "default" in entry
      ? entry.default
      : undefined;
  if (!isValModules(registry)) {
    throw new Error(
      "val.modules.ts does not export modules(config, [...]) as its default.",
    );
  }
  return registry;
}

function isValModules(value: unknown): value is ValModules {
  return (
    typeof value === "object" &&
    value !== null &&
    "config" in value &&
    "modules" in value &&
    Array.isArray(value.modules) &&
    value.modules.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "def" in entry &&
        typeof entry.def === "function",
    )
  );
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
 */
let queue: { name: string; done: Promise<unknown> } | null = null;
/** The last outcome, and whether the assistant has been told of it. */
let latest: { name: string; outcome: StagedCodeOutcome } | null = null;
const told = new WeakSet<StagedCodeOutcome>();

/** Evaluate proposal `name`'s staged code, after any evaluation of it already running. */
export function runStagedCode(
  name: string,
  deps: StagedCodeDeps,
): Promise<StagedCodeOutcome> {
  const after = queue !== null && queue.name === name ? queue.done : null;
  const done = (async () => {
    if (after !== null) await after.catch(() => undefined);
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
    latest = { name, outcome };
    return outcome;
  })();
  queue = { name, done };
  return done;
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
  queue = null;
  latest = null;
}

/**
 * `StagedCodeDeps.project`: the proposal's files over the site's source, and
 * the inputs a build of them is named for.
 */
export function stagedProject(
  name: string,
  client: Pick<ProposalsClient, "files">,
  siteSource: () => Promise<Record<string, string> | null>,
): StagedCodeDeps["project"] {
  return async () => {
    const [read, site] = await Promise.all([client.files(name), siteSource()]);
    return {
      files: proposalProject(site ?? {}, read.files),
      inputs: read.staged.inputs,
    };
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
