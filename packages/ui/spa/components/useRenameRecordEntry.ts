import { useCallback } from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { useAddModuleFilePatch, useReportError } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { useValSystem } from "../stores/react/SystemContext";
import type { System } from "../stores/createSystem";

export type RenameRecordEntry = (args: {
  /** The record the entry lives in. A router module's record is the module itself. */
  parentPath: SourcePath | ModuleFilePath;
  fromKey: string;
  toKey: string;
  /**
   * Every field pointing at `fromKey`, from a scan that COMPLETED.
   *
   * A rename moves the entry out from under its referrers, so each one has to be
   * rewritten in the same breath or it is left pointing at a key that no longer
   * exists. The list is the caller's because completeness is: a scan is blind to
   * `.jsonValues()` entry content that has not been loaded, and only the caller
   * knows whether it waited for that. See {@link ReferencesResult}.
   */
  refs: SourcePath[];
  /**
   * Whether the record loads its entries on demand (`.jsonValues()`).
   *
   * From the caller because the caller has the resolved schema for the record
   * and this hook has a path. See the load below for what it is for.
   */
  jsonValues?: boolean;
}) => Promise<void>;

/** What {@link renameRecordEntry} did: whether the entry moved, and where to. */
export type RenameRecordEntryResult =
  | {
      status: "renamed";
      moduleFilePath: ModuleFilePath;
      newPatchPath: string[];
    }
  | { status: "not-renamed" };

/**
 * The rename itself, without the navigation: load a `.jsonValues()` entry
 * first (see below), move it, and rewrite what pointed at the old key.
 *
 * Its own function so the scenario harness (`scenarios/`) renames exactly as
 * the toolbar and the Pages panel do. {@link useRenameRecordEntry} calls it
 * and then opens the entry at its new key.
 */
export async function renameRecordEntry(
  deps: {
    system: Pick<System, "sourceStore"> | null;
    addModuleFilePatch: (
      moduleFilePath: ModuleFilePath,
      patch: Patch,
      type: "record",
    ) => void;
    reportError: (title: string, message: string) => void;
  },
  {
    parentPath,
    fromKey,
    toKey,
    refs,
    jsonValues,
  }: Parameters<RenameRecordEntry>[0],
): Promise<RenameRecordEntryResult> {
  const { system, addModuleFilePatch, reportError } = deps;
  if (fromKey === toKey) {
    Internal.log.error("cannot rename an entry onto itself", {
      parentPath,
      fromKey,
    });
    return { status: "not-renamed" };
  }
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const parentPatchPath = Internal.createPatchPath(parentModulePath);
  // A `.jsonValues()` entry is an opaque marker until it is loaded, and a
  // `move` moves what is there - so an unloaded entry would land the marker
  // (not the content) on the new key, and opening it would fetch
  // `/json?key=<newKey>`, which 404s because the base source still only has
  // the old key.
  if (jsonValues && system !== null) {
    const sourceStore = system.sourceStore;
    await sourceStore.loadEntries(moduleFilePath, [fromKey]);
    /*
     * Awaiting that is not the same as having it.
     *
     * `loadEntries` resolves either way: a fetch that fails is RECORDED
     * (`entryFailures`) rather than thrown, and a key that has failed before
     * is skipped entirely, so the await returns immediately with the marker
     * still in place. Moving it is the silent version of this bug - the
     * rename appears to work and the renamed page opens on nothing.
     *
     * `retryEntry` is the one door back in, because a recorded failure makes
     * every later `loadEntries` a no-op: without it a single failed fetch
     * would refuse this rename for the rest of the session. One retry, then
     * refuse - and say so, rather than write a move nobody asked for.
     */
    if (sourceStore.entryError(moduleFilePath, fromKey) !== undefined) {
      const retried = await sourceStore.retryEntry(moduleFilePath, fromKey);
      if (retried.status === "error") {
        reportError(
          "Could not rename",
          `The content of ${fromKey} could not be loaded, and renaming it would move an empty page: ${retried.message}`,
        );
        return { status: "not-renamed" };
      }
    }
  }
  const newPatchPath = parentPatchPath.concat(toKey);
  const patch: Patch = [
    {
      op: "move",
      from: parentPatchPath.concat(fromKey) as array.NonEmptyArray<string>,
      path: newPatchPath as array.NonEmptyArray<string>,
    },
  ];
  addModuleFilePatch(moduleFilePath, patch, "record");
  for (const ref of refs) {
    const [refModuleFilePath, refModulePath] =
      Internal.splitModuleFilePathAndModulePath(ref);
    addModuleFilePatch(
      refModuleFilePath,
      [
        {
          op: "replace",
          path: Internal.createPatchPath(refModulePath),
          value: toKey,
        },
      ],
      "record",
    );
  }
  return { status: "renamed", moduleFilePath, newPatchPath };
}

/**
 * Move a record entry to a new key, rewrite what pointed at the old one, and
 * open it there.
 *
 * `useDuplicateRecordEntry`'s sibling, and separate from it for the one reason
 * that makes a rename harder than a copy: a copy leaves the original where it
 * was, so nothing that referred to it is affected, while a rename invalidates
 * every reference to the old key. Both places that offer a rename - the entry's
 * own toolbar and the Pages panel - come through here, so they cannot come to
 * disagree about what renaming means.
 */
export function useRenameRecordEntry(): RenameRecordEntry {
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const { navigate } = useNavigation();
  const val = useValSystem();
  const reportError = useReportError();
  return useCallback(
    async (args) => {
      const res = await renameRecordEntry(
        { system: val?.system ?? null, addModuleFilePatch, reportError },
        args,
      );
      if (res.status !== "renamed") return;
      // `replace`, because the path that was open is a path that no longer
      // exists: leaving it in history is leaving a dead entry to go Back to.
      navigate(
        Internal.joinModuleFilePathAndModulePath(
          res.moduleFilePath,
          Internal.patchPathToModulePath(res.newPatchPath),
        ),
        { replace: true },
      );
    },
    [addModuleFilePatch, navigate, val, reportError],
  );
}
