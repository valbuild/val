import { useCallback } from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { useAddModuleFilePatch } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { useValSystem } from "../stores/react/SystemContext";

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
  return useCallback(
    async ({ parentPath, fromKey, toKey, refs, jsonValues }) => {
      if (fromKey === toKey) {
        console.error("Val: cannot rename an entry onto itself", {
          parentPath,
          fromKey,
        });
        return;
      }
      const [moduleFilePath, parentModulePath] =
        Internal.splitModuleFilePathAndModulePath(parentPath);
      const parentPatchPath = Internal.createPatchPath(parentModulePath);
      // A `.jsonValues()` entry is an opaque marker until it is loaded, and a
      // `move` moves what is there - so an unloaded entry would land the marker
      // (not the content) on the new key, and opening it would fetch
      // `/json?key=<newKey>`, which 404s because the base source still only has
      // the old key. The same window `useDuplicateRecordEntry` loads through.
      if (jsonValues && val !== null) {
        await val.system.sourceStore.loadEntries(moduleFilePath, [fromKey]);
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
      // `replace`, because the path that was open is a path that no longer
      // exists: leaving it in history is leaving a dead entry to go Back to.
      navigate(
        Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          Internal.patchPathToModulePath(newPatchPath),
        ),
        { replace: true },
      );
    },
    [addModuleFilePatch, navigate, val],
  );
}
