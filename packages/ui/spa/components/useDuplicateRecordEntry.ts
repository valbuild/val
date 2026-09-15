import { useCallback } from "react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { useAddModuleFilePatch, useReportError } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { useValSystem } from "../stores/react/SystemContext";
import { loadEntryContent } from "./loadEntryContent";

export type DuplicateRecordEntry = (args: {
  /** The record the entry lives in. A router module's record is the module itself. */
  parentPath: SourcePath | ModuleFilePath;
  fromKey: string;
  toKey: string;
  /**
   * Whether the record loads its entries on demand (`.jsonValues()`).
   *
   * From the caller because the caller has the resolved schema for the record
   * and this hook has a path. See the load below for what it is for.
   */
  jsonValues?: boolean;
}) => Promise<void>;

/**
 * Copy a record entry to a new key, and open the copy.
 *
 * One `copy` op does the whole job. The value at the old key is duplicated by
 * the same code that applies every other patch, on the client and again on the
 * server, so there is no second idea here of what a page's contents are - which
 * is what a "read the source out, then write it back under a new key"
 * duplicate would have been. Media comes along by reference: the copy points at
 * the same uploaded bytes, so duplicating a page with a gallery on it does not
 * re-upload the gallery.
 *
 * `useAddPage`'s sibling on purpose. A duplicate is an add whose value is an
 * existing entry rather than `emptyOf(item)`, and both places that offer it -
 * the page's own toolbar and the Pages panel - come through here, so they
 * cannot come to disagree about what duplicating means.
 */
export function useDuplicateRecordEntry(): DuplicateRecordEntry {
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const { navigate } = useNavigation();
  const val = useValSystem();
  const reportError = useReportError();
  return useCallback(
    async ({ parentPath, fromKey, toKey, jsonValues }) => {
      if (fromKey === toKey) {
        console.error("Val: cannot duplicate an entry onto itself", {
          parentPath,
          fromKey,
        });
        return;
      }
      const [moduleFilePath, parentModulePath] =
        Internal.splitModuleFilePathAndModulePath(parentPath);
      const parentPatchPath = Internal.createPatchPath(parentModulePath);
      // A `.jsonValues()` entry is an opaque marker until it is loaded, and a
      // `copy` copies what is there - so an unloaded entry would duplicate the
      // marker instead of the page, and opening the copy would fetch
      // `/json?key=<newKey>`, which 404s because the base source has no such
      // key. `loadEntryContent` is what makes sure it is actually here: awaiting
      // the load is not the same as having it. Same guard as a rename's.
      if (jsonValues && val !== null) {
        const loaded = await loadEntryContent(
          val.system.sourceStore,
          moduleFilePath,
          fromKey,
        );
        if (loaded.status === "error") {
          reportError(
            "Could not duplicate",
            `The content of ${fromKey} could not be loaded, and duplicating it would copy an empty page: ${loaded.message}`,
          );
          return;
        }
      }
      const newPatchPath = parentPatchPath.concat(toKey);
      addModuleFilePatch(
        moduleFilePath,
        [
          {
            op: "copy",
            from: parentPatchPath.concat(fromKey),
            path: newPatchPath,
          },
        ],
        "record",
      );
      // Straight into the copy: duplicating a page is the first half of
      // editing one, and being left looking at the original is the step
      // `useAddPage` already refuses to make people take.
      navigate(
        Internal.joinModuleFilePathAndModulePath(
          moduleFilePath,
          Internal.patchPathToModulePath(newPatchPath),
        ),
      );
    },
    [addModuleFilePatch, navigate, val, reportError],
  );
}
