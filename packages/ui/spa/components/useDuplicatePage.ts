import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { useSchemas } from "./ValFieldProvider";
import { useDuplicateRecordEntry } from "./useDuplicateRecordEntry";

/**
 * Copy a page to another URL under the same router, and open the copy.
 *
 * The router module IS the record, so the two URLs are the two keys and the
 * copy is one `copy` op - see `useDuplicateRecordEntry`, which the page's own
 * toolbar goes through as well.
 *
 * `useAddPage`'s sibling, and separate from `useDuplicateRecordEntry` for the
 * same reason that one is separate from the nav menu: the schema lookup and its
 * refusals are the part that is easy to get subtly wrong in a second copy.
 */
export function useDuplicatePage(): (
  moduleFilePath: ModuleFilePath,
  fromUrlPath: string,
  toUrlPath: string,
) => void {
  const duplicateRecordEntry = useDuplicateRecordEntry();
  const schemas = useSchemas();
  return useCallback(
    (
      moduleFilePath: ModuleFilePath,
      fromUrlPath: string,
      toUrlPath: string,
    ) => {
      // `jsonValues` decides whether the source entry has to be loaded before
      // it can be copied, so guessing it while the schemas are still in flight
      // duplicates the opaque marker instead of the page - and the copy then
      // opens on a `/json?key=<newKey>` that 404s. Refuse, the way `useAddPage`
      // and `DuplicateRecordPopover` do, rather than write the wrong patch.
      if (schemas.status !== "success") {
        console.error(
          "Val: cannot duplicate a page before the schemas have loaded",
        );
        return;
      }
      const schema = schemas.data[moduleFilePath];
      if (!schema || schema.type !== "record") {
        console.error(
          "Val: cannot duplicate a page in a module that is not a record",
          { moduleFilePath, schema },
        );
        return;
      }
      void duplicateRecordEntry({
        parentPath: moduleFilePath,
        fromKey: fromUrlPath,
        toKey: toUrlPath,
        jsonValues: schema.jsonValues === true,
      });
    },
    [duplicateRecordEntry, schemas],
  );
}
