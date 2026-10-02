import { useMemo } from "react";
import {
  rejectScheme,
  type ModuleFilePath,
  type SerializedSchema,
} from "@valbuild/core";
import { useValSystem } from "../../stores/react/SystemContext";
import { useCreateRouteEntry } from "../useCreateRouteEntry";
import {
  collectCreatableRouters,
  type CreatableRouter,
} from "../creatableRouters";
import type { RichTextExternalPages } from "../RichTextEditor";

/**
 * The project's external pages router, found once per schema map.
 *
 * Keyed on the map itself, which intake replaces wholesale, so a schema change
 * is a new key and nothing has to invalidate this. Sources are not passed: the
 * existing keys are not needed here (see `canAdd` below).
 */
const externalRouterCache = new WeakMap<
  Record<ModuleFilePath, SerializedSchema>,
  CreatableRouter | null
>();

function externalRouterOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): CreatableRouter | null {
  const cached = externalRouterCache.get(schemas);
  if (cached !== undefined) return cached;
  const router = collectCreatableRouters(schemas, {}).externalRouter;
  externalRouterCache.set(schemas, router);
  return router;
}

/**
 * "Add & link", for a field that only links to routes.
 *
 * A URL elsewhere can be linked from `s.richtext({ a: true })` only once it is
 * a key of the project's external pages router — so the bar offers to make it
 * one, through the same `createRouteEntry` the sitemap, the external pages
 * dialog and `RouteField` use. Offered only for a URL that would then be
 * linkable: one the router's `schemes` accept and the field's include/exclude
 * let through. A URL that is already a key needs no adding: it is in the
 * catalog, so it was never "not allowed".
 *
 * Subscribes to NOTHING. This is mounted once per rich text field, so
 * `useSchemas()` here would wake every one of them on project-wide changes —
 * `perFieldSubscriptions.test.ts` refuses it. The schemas are read from the
 * store when the bar asks, which is on a render it was already doing because
 * the field's own URLs changed.
 */
export function useRichTextExternalPages(
  allowsRoute: ((route: string) => boolean) | undefined,
  readonly: boolean | undefined,
): RichTextExternalPages | undefined {
  const val = useValSystem();
  const createRouteEntry = useCreateRouteEntry();
  return useMemo((): RichTextExternalPages | undefined => {
    if (val === null || !allowsRoute || readonly) return undefined;
    const router = () => externalRouterOf(val.system.schemaStore.all());
    return {
      canAdd: (url) => {
        const externalRouter = router();
        return (
          externalRouter !== null &&
          rejectScheme(url, { schemes: externalRouter.schemes }) === null &&
          allowsRoute(url)
        );
      },
      add: (urls) => {
        const externalRouter = router();
        if (externalRouter === null) return;
        for (const url of urls) createRouteEntry(externalRouter, url);
      },
    };
  }, [val, allowsRoute, readonly, createRouteEntry]);
}
