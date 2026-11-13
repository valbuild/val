import { useCallback, useMemo, useRef } from "react";
import { Internal, ModuleFilePath, ModulePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useAddModuleFilePatch } from "./ValProvider";
import { useSchemas } from "./ValFieldProvider";
import { useValSystem } from "../stores/react/SystemContext";
import {
  sameDeep,
  sameItems,
  useStoreValue,
} from "../stores/react/useStoreValue";

import {
  CreatableRouter,
  collectCreatableRouters,
  routerModulesOf,
} from "./creatableRouters";
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
  const val = useValSystem();
  const schemas = useSchemas();
  const schemaData =
    "data" in schemas && schemas.data !== undefined ? schemas.data : null;
  const routerPaths = useMemo(
    () => (schemaData === null ? NO_ROUTERS : routerModulesOf(schemaData)),
    [schemaData],
  );
  /*
   * The routers' own sources, not every module's, and the answer before
   * while it says the same: a router's keys move when a page is added,
   * renamed or removed. `useAllSources` moves on every field write anywhere,
   * and so does the source of the router a page being typed in belongs to --
   * and this is read by the shell and by every route field, which rendered
   * for each write to be handed the same routers.
   */
  const kept = useRef<{
    sources: unknown[];
    routers: CreatableRouters;
  } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.sourceStore.events.on("source:change", onChange);
    },
    [val],
  );
  const version = useCallback(
    () => (val === null ? -1 : val.system.sourceStore.sourcesVersion()),
    [val],
  );
  const read = useCallback((): CreatableRouters => {
    if (val === null || schemaData === null) return NO_CREATABLE_ROUTERS;
    const sources = routerPaths.map((moduleFilePath) =>
      val.system.sourceStore.moduleSource(moduleFilePath),
    );
    const previous = kept.current;
    if (previous !== null && sameItems(previous.sources, sources)) {
      return previous.routers;
    }
    const byModule: Record<ModuleFilePath, unknown> = {};
    routerPaths.forEach((moduleFilePath, index) => {
      byModule[moduleFilePath] = sources[index];
    });
    const routers = collectCreatableRouters(schemaData, byModule);
    kept.current = {
      sources,
      routers:
        previous !== null && sameDeep(previous.routers, routers)
          ? previous.routers
          : routers,
    };
    return kept.current.routers;
  }, [val, schemaData, routerPaths]);
  return useStoreValue(subscribe, read, { version });
}

type CreatableRouters = {
  pageRouters: CreatableRouter[];
  externalRouter: CreatableRouter | null;
};
const NO_CREATABLE_ROUTERS: CreatableRouters = {
  pageRouters: [],
  externalRouter: null,
};
const NO_ROUTERS: ModuleFilePath[] = [];

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
        Internal.log.error("Cannot create route entry: schemas are not loaded");
        return null;
      }
      const schema = val.system.schemaStore.all()[router.moduleFilePath];
      if (schema?.type !== "record") {
        Internal.log.error("Cannot create route entry: not a record", {
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
