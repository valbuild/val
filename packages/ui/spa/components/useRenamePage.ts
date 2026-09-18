import { useCallback } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useSchemas } from "./ValFieldProvider";
import { useReportError } from "./ValProvider";
import { useValSystem } from "../stores/react/SystemContext";
import { useRenameRecordEntry } from "./useRenameRecordEntry";
import { jsonValuesLoadRequirements } from "./jsonValuesLoadRequirements";
import { getKeysOf } from "./getKeysOf";
import { getRouteReferences } from "./getRouteReferences";

/**
 * Change a page's URL, rewrite what pointed at the old one, and open it there.
 *
 * The router module IS the record, so the two URLs are the two keys and the
 * rename is one `move` op plus a rewrite of every referrer - see
 * `useRenameRecordEntry`, which the page's own toolbar goes through as well.
 *
 * ## Why the reference scan happens here rather than in the panel
 *
 * A rename moves the entry out from under everything pointing at it, and a scan
 * is blind to `.jsonValues()` entry content that has not been loaded - so a
 * rename on an incomplete scan silently leaves referrers pointing at a URL that
 * no longer exists. `ChangeRecordPopover` gates on that by rendering "Checking
 * references" until the load finishes, because it is a popover that can wait.
 *
 * The Pages panel is a list of rows and cannot hold a scan open for each of
 * them, so the wait moves to the submit: the content the scan needs is loaded
 * WHEN a rename is asked for, and the rename only goes ahead once it is there.
 * Either way nothing is written on the strength of a scan that could not see
 * everything - which is the whole rule.
 */
export function useRenamePage(): (
  moduleFilePath: ModuleFilePath,
  fromUrlPath: string,
  toUrlPath: string,
) => void {
  const renameRecordEntry = useRenameRecordEntry();
  const schemas = useSchemas();
  const val = useValSystem();
  const reportError = useReportError();
  return useCallback(
    (
      moduleFilePath: ModuleFilePath,
      fromUrlPath: string,
      toUrlPath: string,
    ) => {
      // The same refusals `useDuplicatePage` makes, for the same reason: with
      // the schemas unresolved, `jsonValues` would have to be guessed - and a
      // `move` of an entry that is still an opaque marker moves the marker
      // instead of the page.
      if (schemas.status !== "success") {
        console.error(
          "Val: cannot rename a page before the schemas have loaded",
        );
        return;
      }
      const schema = schemas.data[moduleFilePath];
      if (!schema || schema.type !== "record") {
        console.error(
          "Val: cannot rename a page in a module that is not a record",
          { moduleFilePath, schema },
        );
        return;
      }
      if (val === null) {
        console.error("Val: cannot rename a page: no store system is mounted");
        return;
      }
      const schemasData = schemas.data;
      // Both kinds of referrer a page key has: `s.keyOf()` fields naming this
      // router's key, and `s.route()` fields carrying the URL as their value.
      // `getRouteReferences` matches by VALUE because a route schema records no
      // target module - which is also why its load requirement is every
      // jsonValues record with a route field in it, rather than this one.
      const required = Array.from(
        new Set([
          ...jsonValuesLoadRequirements(schemasData, {
            kind: "keyOf",
            module: moduleFilePath,
          }),
          ...jsonValuesLoadRequirements(schemasData, { kind: "route" }),
        ]),
      );
      const sourceStore = val.system.sourceStore;
      void (async () => {
        if (required.length > 0) {
          await Promise.all(
            required.map((required) => sourceStore.loadAllEntries(required)),
          );
          let status = sourceStore.entriesStatus(required);
          if (status.status === "error") {
            /*
             * One retry, because a failure is otherwise permanent.
             *
             * `loadAllEntries` records a failed entry and every later load
             * SKIPS it - deliberately, so that a broken entry is not a fetch
             * loop. `retryEntry` is the one door back in, so without this a
             * single failed fetch would refuse every rename in the project for
             * the rest of the session, with nothing the editor could do about
             * it but reload the page.
             */
            await Promise.all(
              status.errors.map((failed) =>
                sourceStore.retryEntry(failed.moduleFilePath, failed.key),
              ),
            );
            status = sourceStore.entriesStatus(required);
          }
          if (status.status !== "complete") {
            // Renaming now would rewrite only the referrers that happen to be
            // loaded and leave the rest pointing at a URL that is about to stop
            // existing. Refuse, visibly: this is a failure of the rename, not a
            // slow load.
            reportError(
              "Could not rename page",
              status.status === "error"
                ? `Content that could link to this page failed to load: ${status.errors[0]?.message ?? "unknown error"}`
                : "Content that could link to this page could not be loaded.",
            );
            return;
          }
        }
        const sources = sourceStore.allSources();
        const refs: SourcePath[] = [];
        for (const ref of [
          ...getKeysOf(schemasData, sources, moduleFilePath, fromUrlPath),
          ...getRouteReferences(schemasData, sources, fromUrlPath),
        ]) {
          if (!refs.includes(ref)) {
            refs.push(ref);
          }
        }
        await renameRecordEntry({
          parentPath: moduleFilePath,
          fromKey: fromUrlPath,
          toKey: toUrlPath,
          refs,
          jsonValues: schema.jsonValues === true,
        });
      })();
    },
    [renameRecordEntry, schemas, val, reportError],
  );
}
