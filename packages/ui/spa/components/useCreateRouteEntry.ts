import { useCallback, useMemo } from "react";
import { Internal, ModulePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useAddModuleFilePatch } from "./ValProvider";
import { useSchemas, useAllSources } from "./ValFieldProvider";
import { useValSystem } from "../stores/react/SystemContext";

import { CreatableRouter, collectCreatableRouters } from "./creatableRouters";
import { useEmptyOf } from "../hooks/useEmptyOf";

export type { CreatableRouter };

/**
 * The routers an editor can create a page in, split by kind.
 *
 * A router module is a record carrying a `router` id. The external one is
 * `external-url-router`, whose keys are absolute URLs rather than route
 * patterns - so it needs a plain URL input, not the segment inputs a page
 * route gets.
 */
export function useCreatableRouters(): {
  pageRouters: CreatableRouter[];
  externalRouter: CreatableRouter | null;
} {
  const schemas = useSchemas();
  const allSources = useAllSources();

  return useMemo(() => {
    if (!("data" in schemas) || schemas.data === undefined) {
      return { pageRouters: [], externalRouter: null };
    }
    return collectCreatableRouters(schemas.data, allSources);
  }, [schemas, allSources]);
}

/**
 * Creates an entry in a router module and returns its key.
 *
 * This is the same operation the sitemap's "Add page" performs - add
 * `emptyOf(item)` at the new key - lifted out so a `s.route()` field can do it
 * too, without the editor having to leave the field, create the page, and come
 * back to link it.
 *
 * The schemas are read from the store when it is CALLED, not subscribed to.
 * `RouteField` and the rich text field call this, both mounted once per field,
 * and a `useSchemas()` here made every one of them a whole-project
 * subscription for a function nobody calls until they click — see
 * `perFieldSubscriptions.test.ts`.
 */
export function useCreateRouteEntry(): (
  router: CreatableRouter,
  key: string,
) => string | null {
  const { addModuleFilePatch } = useAddModuleFilePatch();
  const val = useValSystem();
  const emptyOf = useEmptyOf();

  return useCallback(
    (router: CreatableRouter, key: string) => {
      if (val === null) {
        console.error("Cannot create route entry: schemas are not loaded");
        return null;
      }
      const schema = val.system.schemaStore.all()[router.moduleFilePath];
      if (schema?.type !== "record") {
        console.error("Cannot create route entry: not a record", {
          moduleFilePath: router.moduleFilePath,
          schema,
        });
        return null;
      }
      addModuleFilePatch(
        router.moduleFilePath,
        [
          {
            op: "add",
            path: Internal.createPatchPath("" as ModulePath).concat(key),
            value: emptyOf(schema.item) as JSONValue,
          },
        ],
        "record",
      );
      return key;
    },
    [addModuleFilePatch, val, emptyOf],
  );
}
