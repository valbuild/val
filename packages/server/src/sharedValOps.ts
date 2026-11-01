import { Internal, type ValModules } from "@valbuild/core";
import type { ValOpsFS } from "./ValOpsFS";
import type { ValOpsHttp } from "./ValOpsHttp";
import type { ValOpsMemory } from "./ValOpsMemory";
import type { ValServerConfig } from "./ValServer";
import { createValOps } from "./valServerConfig";

type AnyValOps = ValOpsFS | ValOpsHttp | ValOpsMemory;
type Entry = { options: ValServerConfig; ops: AnyValOps };

/**
 * The data layer every server in this process builds for one project, kept
 * so they share it.
 *
 * An app builds several Val servers: the API route (`initValServer`), the
 * readers that render draft content on the server (`initValContent`,
 * `initValRsc`) and MCP (`initValMcp`). Each used to build its own `ValOps`,
 * and a `ValOps` holds the project's evaluated content and moves it forward
 * when it handles a publish (`adoptCommittedSources`). So a publish through
 * the API moved the API's copy and no other: in memory mode a page's readers
 * went on showing the content from before it (finding R1 in
 * `scenarios/README.md`). Handing them one instance removes the second copy,
 * which is the first step of "one runtime per process" in
 * `docs/plans/one-content-model.md`.
 *
 * Keyed on the `valModules` object, which is what identifies the project in
 * the process: hot reload makes a new one, and the old instance goes with it
 * (a WeakMap). Then on the options that decide what the data layer IS (mode,
 * where its content and patches live, which project and commit). Two callers
 * that differ there get separate instances, as before; when the mode is the
 * same, that is almost always a mistake (the same patch store not passed to
 * both, say), and it is logged.
 *
 * The formatter is not part of the key: the readers never save, so they pass
 * none, and the instance takes the API's when it is given one.
 */
const registry = new WeakMap<ValModules, Entry[]>();

export function sharedValOps(
  valModules: ValModules,
  options: ValServerConfig,
): AnyValOps {
  const entries = registry.get(valModules) ?? [];
  for (const entry of entries) {
    if (differences(entry.options, options).length === 0) {
      if (options.formatter !== undefined) {
        entry.ops.adoptFormatter(options.formatter);
      }
      return entry.ops;
    }
  }
  const sameMode = entries.find((entry) => entry.options.mode === options.mode);
  if (sameMode !== undefined) {
    // A different root is a different project, not a mistake.
    const differ = differences(sameMode.options, options).filter(
      (field) => field !== "cwd",
    );
    if (differ.length > 0) {
      Internal.log.warn(
        `two Val servers for the same val.modules were given different options (${differ.join(", ")}), so they keep separate content: a publish through one is not seen by the other. Pass the same options to initValServer and initValContent (and initValMcp).`,
      );
    }
  }
  const ops = createValOps(valModules, options);
  entries.push({ options, ops });
  registry.set(valModules, entries);
  return ops;
}

/** The options that decide what the data layer is, where two configs differ. */
function differences(a: ValServerConfig, b: ValServerConfig): string[] {
  if (a.mode !== b.mode) return ["mode"];
  const differ: string[] = [];
  const check = (field: string, same: boolean) => {
    if (!same) differ.push(field);
  };
  check("valContentUrl", a.valContentUrl === b.valContentUrl);
  check("config", sameValue(a.config, b.config));
  if (a.mode === "fs" && b.mode === "fs") {
    check("cwd", a.cwd === b.cwd);
  } else if (a.mode === "memory" && b.mode === "memory") {
    // A store is compared by identity: two empty stores are equal as JSON
    // and are still two places for edits to go.
    check("patchStore", a.patchStore === b.patchStore);
    check("sourceFiles", sameValue(a.sourceFiles, b.sourceFiles));
    check(
      "unsafelyAllowUnauthenticated",
      (a.unsafelyAllowUnauthenticated ?? false) ===
        (b.unsafelyAllowUnauthenticated ?? false),
    );
  } else if (a.mode === "http" && b.mode === "http") {
    check("project", a.project === b.project);
    check("apiKey", a.apiKey === b.apiKey);
    check("git", sameValue(a.git, b.git));
    check("root", a.root === b.root);
    check("projectSource", sameValue(a.projectSource, b.projectSource));
    check("publishJob", a.publishJob === b.publishJob);
    check("publishBuild", a.publishBuild === b.publishBuild);
    check("proposal", sameValue(a.proposal, b.proposal));
    check("contentVersion", sameValue(a.contentVersion, b.contentVersion));
  }
  return differ;
}

/** The same object, or equal as JSON: options are often rebuilt per caller. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
