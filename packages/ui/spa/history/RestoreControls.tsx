import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useHistoryParams } from "../components/ValRouter";
import { Button } from "../components/designSystem/button";
import { enterRestore, exitRestore } from "./historyParams";
import type { DirectedRestore } from "./useDirectedRestore";
import { restorability } from "./HistoryPane";
import { planModuleRevert, planRevertAll } from "./revertAll";
import { useAddPatch } from "../components/ValFieldProvider";
import { useClient } from "../components/ValProvider";
import { useState } from "react";
import type { PatchId } from "@valbuild/core";
import { restoreProposalName } from "./restoreDestination";
import { planGoBack, type GoBackModule } from "./goBack";
import { useValSystem } from "../stores/react/SystemContext";
import { useLandRestore } from "./useLandRestore";

/**
 * How many entries of one module are read at a time.
 *
 * `/history/json` is one request per entry - the endpoint is built for a pane
 * that opens one entry at a time - so a record with a thousand support pages
 * would otherwise open a thousand sockets at once. Sequential would be honest
 * and far too slow; this is the middle.
 */
const ENTRY_FETCH_CONCURRENCY = 8;

/**
 * The controls at the top of the history pane.
 *
 * Three things, in the order people reach for them: restore ONE thing (the
 * common case, and the one the whole directed design is for), put EVERYTHING
 * back (the "that publish was a mistake" case), and leave.
 *
 * When a commit cannot be restored from, the controls are disabled with the
 * reason beside them rather than hidden. A control that vanishes leaves someone
 * looking for it; a disabled one that explains itself answers the question they
 * were about to ask.
 */
export function RestoreControls({
  patchSet,
  path,
  restore,
}: {
  patchSet: HistoricalPatchSet | undefined;
  path: SourcePath | null;
  restore: DirectedRestore;
}) {
  const { history, setHistory } = useHistoryParams();
  const { canRestore, reason } = restorability(patchSet);
  const [reverting, setReverting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * `.jsonValues()` entry content, once something has asked for it: by module,
   * then entry key - and stamped with the commit it was read at.
   *
   * Held here rather than fetched with the commit: it is a request per entry,
   * and only a restore needs it. Kept afterwards because a commit's content
   * cannot change, so a second restore of the same module is free.
   *
   * The stamp is what makes keeping it safe. These controls are not remounted
   * when the pane moves to another commit, so content read at one commit would
   * otherwise still be here to stage at the next - putting back the wrong
   * version, silently, with nothing fetched to notice. A read that lands after
   * the move is discarded for the same reason.
   */
  const [jsonEntries, setJsonEntries] = useState<{
    commitSha: string;
    byModule: Record<ModuleFilePath, Record<string, JSONValue>>;
  }>({ commitSha: "", byModule: {} });
  const { writeModulePatch } = useAddPatch(path ?? ("" as SourcePath));
  const client = useClient();
  const land = useLandRestore(restore.destination);
  const val = useValSystem();
  const toProposal = restore.destination.kind === "proposal";
  /** "Put everything back" handing its patches over again, after a failure. */
  const [revertRetry, setRevertRetry] = useState<(() => void) | null>(null);

  if (!patchSet) {
    return null;
  }
  const commitSha = patchSet.commit.commitSha;
  /** Only what was read at the commit on screen; anything older is not ours. */
  const entriesHere =
    jsonEntries.commitSha === commitSha ? jsonEntries.byModule : {};
  /** Keep a read only while the pane is still on the commit it was read at. */
  const rememberEntries = (
    forModule: ModuleFilePath,
    entries: Record<string, JSONValue>,
  ) => {
    setJsonEntries((current) => ({
      commitSha,
      byModule:
        current.commitSha === commitSha
          ? { ...current.byModule, [forModule]: entries }
          : { [forModule]: entries },
    }));
  };
  const inRestoreMode = history.restore.mode !== "off";
  const moduleFilePath =
    path === null
      ? null
      : (Internal.splitModuleFilePathAndModulePath(path)[0] as ModuleFilePath);
  /*
   * The module on screen, if this commit recorded it.
   *
   * `null` on the modules-changed list (no module chosen) and on a module the
   * commit did not change — the pane can show that one, because it asks how it
   * looked as of the commit, but this commit has nothing of its own to restore
   * from. Both cases matter below: they are what the module button is offered
   * for and what "Put everything back" has to be honest about.
   */
  const moduleHere =
    moduleFilePath !== null ? patchSet.modules[moduleFilePath] : undefined;
  /*
   * Whether this module can be put back WHOLE, asked of the same function "Put
   * everything back" asks.
   *
   * One function for both, because they write the same thing: a `.jsonValues()`
   * module's value is its entries' CONTENT, read at the commit, never the
   * recorded Source - which holds `{_type:"json"}` markers, and writing those
   * back would put markers where the content is. Two answers to that question
   * is how one button comes to write what the other refuses.
   */
  const revertHere =
    moduleHere === undefined || moduleFilePath === null
      ? null
      : planModuleRevert(moduleHere, entriesHere[moduleFilePath]);
  const restorableHere = revertHere !== null && revertHere.kind !== "blocked";
  /*
   * What "Put everything back" would actually stage, asked of the plan itself.
   *
   * Counting the commit's modules here instead would give a number that drifts
   * from the button the moment the plan excludes one, and a scope note that
   * overstates the scope is worse than none. Modules whose entry content has
   * not been read yet COUNT: they are put back too, after a read the click
   * pays for.
   */
  const revertPlan = planRevertAll(patchSet, entriesHere);
  const revertCount =
    revertPlan.modules.length + revertPlan.needsJsonEntries.length;
  const revertTouchesThisModule =
    moduleFilePath !== null &&
    (revertPlan.modules.some(
      (entry) => entry.moduleFilePath === moduleFilePath,
    ) ||
      revertPlan.needsJsonEntries.some(
        (entry) => entry.moduleFilePath === moduleFilePath,
      ));

  /**
   * One module's `.jsonValues()` entries, as they were at this commit.
   *
   * The content is not in the commit's record of the module - that is markers -
   * so each entry is read from `/history/json`, the same endpoint the pane uses
   * to render one. Returns a message instead of content when an entry cannot be
   * read: a restore that silently left an entry out would write a record
   * missing it, which deletes the entry.
   */
  const loadJsonEntries = async (
    forModule: ModuleFilePath,
    entryKeys: string[],
  ): Promise<{ entries: Record<string, JSONValue> } | { message: string }> => {
    const loaded: Record<string, JSONValue> = {};
    for (let i = 0; i < entryKeys.length; i += ENTRY_FETCH_CONCURRENCY) {
      const batch = entryKeys.slice(i, i + ENTRY_FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(
          async (
            key,
          ): Promise<
            { key: string; content: JSONValue } | { message: string }
          > => {
            try {
              const res = await client("/history/json", "GET", {
                query: {
                  commit_sha: patchSet.commit.commitSha,
                  path: forModule,
                  key,
                },
              });
              if (res.status !== 200) {
                return {
                  message: `Could not read '${key}' of ${forModule} as it was at this commit${
                    "message" in res.json ? `: ${res.json.message}` : ""
                  }`,
                };
              }
              return { key, content: res.json.content as JSONValue };
            } catch (err) {
              // A network failure rather than a refusal, reported the same way:
              // what matters is that the content is not all here.
              return {
                message: `Could not read '${key}' of ${forModule} as it was at this commit: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              };
            }
          },
        ),
      );
      for (const entry of results) {
        if ("message" in entry) {
          return { message: entry.message };
        }
        loaded[entry.key] = entry.content;
      }
    }
    return { entries: loaded };
  };

  const restoreWholeModule = async () => {
    if (
      moduleFilePath === null ||
      moduleHere === undefined ||
      moduleHere.schema === null ||
      revertHere === null ||
      revertHere.kind === "blocked"
    ) {
      return;
    }
    if (revertHere.kind === "patch") {
      setReverting(null);
      restore.restoreWholeModule(
        moduleFilePath,
        revertHere.value,
        moduleHere.schema,
      );
      return;
    }
    setBusy(true);
    setReverting("Reading this module's entries as they were…");
    const loaded = await loadJsonEntries(moduleFilePath, revertHere.entryKeys);
    setBusy(false);
    if ("message" in loaded) {
      setReverting(loaded.message);
      return;
    }
    rememberEntries(moduleFilePath, loaded.entries);
    const planned = planModuleRevert(moduleHere, loaded.entries);
    if (planned.kind !== "patch") {
      setReverting(
        planned.kind === "blocked"
          ? planned.reason
          : `Could not read every entry of ${moduleFilePath} as it was at this commit.`,
      );
      return;
    }
    setReverting(null);
    restore.restoreWholeModule(
      moduleFilePath,
      planned.value,
      moduleHere.schema,
    );
  };

  /**
   * Hand written patches to where restores go, saying how it went, with Try
   * again when the hand-over is what failed. Shared by "Put everything back"
   * and "Go back to this point".
   */
  const handOver = async (
    written: PatchId[],
    displayName: string,
    note: string,
    /** "Go back to this point": the site commit whose code comes back too. */
    restoreCodeFrom?: string,
  ): Promise<void> => {
    setRevertRetry(null);
    setBusy(true);
    setReverting(
      `Opening a proposal with ${written.length} module${written.length === 1 ? "" : "s"} put back${restoreCodeFrom !== undefined ? ", and the code as it was" : ""}…${note}`,
    );
    const landed = await land(written, displayName, restoreCodeFrom);
    setBusy(false);
    if (landed.status === "error") {
      setReverting(landed.message);
      setRevertRetry(
        () => () => void handOver(written, displayName, note, restoreCodeFrom),
      );
    }
  };

  const revertEverything = async () => {
    /*
     * The entry content first, for the modules that need it, and only then the
     * staging: a module put back from half its entries is a module with the
     * other half deleted, so nothing is staged until the read is complete.
     */
    let entries = entriesHere;
    const unreadable: ModuleFilePath[] = [];
    if (revertPlan.needsJsonEntries.length > 0) {
      setBusy(true);
      setReverting("Reading the entries as they were…");
      for (const { moduleFilePath, entryKeys } of revertPlan.needsJsonEntries) {
        const loaded = await loadJsonEntries(moduleFilePath, entryKeys);
        if ("message" in loaded) {
          unreadable.push(moduleFilePath);
          continue;
        }
        entries = { ...entries, [moduleFilePath]: loaded.entries };
      }
      setBusy(false);
      for (const [forModule, loaded] of Object.entries(entries)) {
        rememberEntries(forModule as ModuleFilePath, loaded);
      }
    }
    const plan = planRevertAll(patchSet, entries);
    const written: PatchId[] = [];
    const failures: string[] = [];
    setBusy(true);
    for (const { moduleFilePath, patch } of plan.modules) {
      const res = await writeModulePatch(moduleFilePath, patch);
      if (res.status === "ok") {
        written.push(res.patchId);
      } else {
        failures.push(`${moduleFilePath}: ${res.message}`);
      }
    }
    setBusy(false);
    const left: ModuleFilePath[] = plan.blocked
      .map((entry) => entry.moduleFilePath)
      .concat(unreadable);
    const leftNote =
      left.length === 0 && failures.length === 0
        ? ""
        : ` ${left.length + failures.length} could not be put back: ${[
            ...left,
            ...failures,
          ].join(", ")}`;
    if (!toProposal || written.length === 0) {
      setReverting(
        left.length === 0 && failures.length === 0
          ? `Added ${written.length} module${written.length === 1 ? "" : "s"} to your pending changes. Review and publish when you are ready.`
          : `Added ${written.length} to your pending changes.${leftNote}`,
      );
      return;
    }
    /*
     * On the site of a project with proposals, what was written goes into a
     * new proposal, and the Studio goes there to review it.
     */
    await handOver(
      written,
      restoreProposalName(patchSet.commit.createdAt, "everything"),
      leftNote,
    );
  };

  /**
   * Every module as it was at this commit -- not only the ones it changed.
   *
   * Content only: code is not patched. On the site of a project with
   * proposals it opens one, like every restore (valbuild/home
   * `docs/hosted-publishing.md`, step 9).
   */
  const goBackToThisPoint = async () => {
    if (val === null) return;
    const { schemaStore, sourceStore } = val.system;
    const paths = Object.keys(schemaStore.all()).filter(
      (path): path is ModuleFilePath => path.length > 0,
    );
    setBusy(true);
    setRevertRetry(null);
    setReverting(`Reading ${paths.length} modules as they were…`);
    const modules: GoBackModule[] = [];
    for (let i = 0; i < paths.length; i += ENTRY_FETCH_CONCURRENCY) {
      const batch = paths.slice(i, i + ENTRY_FETCH_CONCURRENCY);
      const read = await Promise.all(
        batch.map(
          async (
            moduleFilePath,
          ): Promise<GoBackModule | { message: string }> => {
            try {
              const res = await client("/history/module", "GET", {
                query: {
                  commit_sha: commitSha,
                  module_file_path: moduleFilePath,
                },
              });
              if (res.status !== 200) {
                return {
                  message: `Could not read ${moduleFilePath} as it was at this commit${
                    "message" in res.json ? `: ${res.json.message}` : ""
                  }`,
                };
              }
              // The module root: its file path with no module path after it.
              const now = await sourceStore.get(
                Internal.joinModuleFilePathAndModulePath(
                  ...Internal.splitModuleFilePathAndModulePath(moduleFilePath),
                ),
                null,
              );
              return {
                moduleFilePath,
                atCommit: res.json.module,
                now: now.status === "resolved-head" ? now.data : undefined,
              };
            } catch (err) {
              return {
                message: `Could not read ${moduleFilePath} as it was at this commit: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              };
            }
          },
        ),
      );
      for (const entry of read) {
        if ("message" in entry) {
          // All or nothing: going back with a module missing is not going back.
          setBusy(false);
          setReverting(entry.message);
          setRevertRetry(() => () => void goBackToThisPoint());
          return;
        }
        modules.push(entry);
      }
    }
    /*
     * On the site of a project with proposals, the code comes back too, in
     * the proposal this opens: every module is written then, because the
     * `.val` files staged with the code hold their build's content.
     */
    const withCode = toProposal ? { everyModule: true } : undefined;
    let plan = planGoBack(modules, undefined, withCode);
    if (plan.needsJsonEntries.length > 0) {
      setReverting("Reading the entries as they were…");
      const entries: Partial<
        Record<ModuleFilePath, Record<string, JSONValue>>
      > = {};
      for (const { moduleFilePath, entryKeys } of plan.needsJsonEntries) {
        const loaded = await loadJsonEntries(moduleFilePath, entryKeys);
        if ("message" in loaded) {
          setBusy(false);
          setReverting(loaded.message);
          setRevertRetry(() => () => void goBackToThisPoint());
          return;
        }
        entries[moduleFilePath] = loaded.entries;
      }
      plan = planGoBack(modules, entries, withCode);
    }
    const written: PatchId[] = [];
    const failures: string[] = [];
    for (const { moduleFilePath, patch } of plan.modules) {
      const res = await writeModulePatch(moduleFilePath, patch);
      if (res.status === "ok") {
        written.push(res.patchId);
      } else {
        failures.push(`${moduleFilePath}: ${res.message}`);
      }
    }
    setBusy(false);
    const left = [
      ...plan.blocked.map(
        (entry) => `${entry.moduleFilePath} (${entry.reason})`,
      ),
      ...plan.unrecorded.map(
        (path) => `${path} (no record of it at that point)`,
      ),
      ...failures,
    ];
    const note =
      left.length === 0
        ? ""
        : ` ${left.length} left as ${left.length === 1 ? "it is" : "they are"}: ${left.join(", ")}`;
    if (written.length === 0) {
      setReverting(`Everything is already as it was at this point.${note}`);
      return;
    }
    if (!toProposal) {
      setReverting(
        `Added ${written.length} module${written.length === 1 ? "" : "s"}, as they were, to your pending changes. Review and publish when you are ready.${note}`,
      );
      return;
    }
    await handOver(
      written,
      restoreProposalName(patchSet.commit.createdAt, "point"),
      note,
      commitSha,
    );
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border-primary p-3">
      <div className="flex flex-wrap items-center gap-2">
        {inRestoreMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistory(exitRestore(history))}
          >
            Done restoring
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canRestore}
            onClick={() => setHistory(enterRestore(history))}
          >
            Restore from here
          </Button>
        )}
        {/*
         * One module, from a commit that changed several.
         *
         * Only in restore mode and only before a value is picked: it is a
         * source pick like any other, and the module root is the one value the
         * field chrome cannot offer because the root is not a `Field`.
         */}
        {inRestoreMode && !restore.from && restorableHere && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={restoreWholeModule}
          >
            Restore this whole module
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!canRestore || busy}
          onClick={revertEverything}
        >
          Put everything back
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canRestore || busy || val === null}
          onClick={() => void goBackToThisPoint()}
        >
          Go back to this point
        </Button>
      </div>
      {/*
       * Said before the click: on the site, a restore does not land in the
       * site's pending changes. It opens a proposal, where it is reviewed and
       * published (valbuild/home `docs/hosted-publishing.md`, step 9).
       */}
      {toProposal && canRestore && (
        <p className="text-xs text-fg-tertiary">
          A restore opens a new proposal with it, to review and publish from
          there.
        </p>
      )}
      {/*
       * What "Put everything back" covers, said before the click.
       *
       * These controls sit above whatever module the editor navigated to, and
       * that is often not a module this commit changed — the pane can still
       * show it, because it asks how the module looked AS OF the commit. The
       * button then reverts a set of modules that are not on screen, which it
       * used to do without saying so.
       */}
      {canRestore && !revertTouchesThisModule && (
        <p className="text-xs text-fg-tertiary">
          {moduleFilePath === null
            ? `“Put everything back” covers the ${revertCount} module${revertCount === 1 ? "" : "s"} this commit changed.`
            : `“Put everything back” will not touch ${moduleFilePath} — it covers the ${revertCount} module${revertCount === 1 ? "" : "s"} this commit changed and can put back.`}
        </p>
      )}
      {inRestoreMode && (
        <p className="text-xs text-fg-secondary">
          {!restore.from
            ? "Pick a field here to restore, then pick where it goes on the left."
            : !restore.toPath
              ? "Now pick where it goes on the left. Fields that cannot hold it are marked."
              : "Nothing is written until you stage it, and nothing is published until you publish."}
        </p>
      )}
      {/* The confirm step. Only reachable once BOTH ends are picked, which is
          the whole point of directing a restore rather than computing one. */}
      {restore.from && restore.toPath && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={
              restore.stage.status === "staging" ||
              restore.stage.status === "opening"
            }
            onClick={restore.confirm}
          >
            {restore.stage.status === "staging"
              ? toProposal
                ? "Opening a proposal…"
                : "Staging…"
              : restore.stage.status === "opening"
                ? "Opening the proposal…"
                : toProposal
                  ? "Restore in a new proposal"
                  : "Stage this restore"}
          </Button>
          {/*
           * Not offered for a whole-module restore: its destination is the
           * module it came from, and "somewhere else" would mean writing a
           * module's value into a field.
           */}
          {Internal.splitModuleFilePathAndModulePath(restore.from.path)[1] !==
            "" && (
            <Button variant="ghost" size="sm" onClick={restore.clearTarget}>
              Pick a different place
            </Button>
          )}
        </div>
      )}
      {restore.stage.status === "staged" && (
        <p className="text-xs text-fg-secondary">
          Done. It is in your pending changes, to review and publish with
          everything else.
        </p>
      )}
      {restore.stage.status === "opening" && (
        <p className="text-xs text-fg-secondary">
          Restored into a new proposal. Opening it…
        </p>
      )}
      {restore.stage.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-fg-error-primary">
            {restore.stage.message}
          </p>
          {restore.stage.retry && (
            <Button variant="outline" size="sm" onClick={restore.stage.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {/* Nothing is written until Publish — said here rather than discovered. */}
      {reverting && <p className="text-xs text-fg-secondary">{reverting}</p>}
      {revertRetry && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={revertRetry}
        >
          Try again
        </Button>
      )}
      {reason && (
        <p className="max-w-prose text-xs text-fg-tertiary">{reason}</p>
      )}
    </div>
  );
}
