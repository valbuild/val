import { useMemo } from "react";
import {
  type SerializedRichTextOptions,
  type SerializedImageSchema,
  type ModuleFilePath,
} from "@valbuild/core";
import { useRoutesWithModulePaths } from "../useRoutesOf";
import { useAllPreviews, useFilePatchIds } from "../ValFieldProvider";
import { mediaUrlOf } from "../../utils/mediaUrl";
import { serializedRichTextOptionsToFeatures } from "./convertOptions";
import type { EditorFeatures, EditorLinkCatalogItem } from "./types";

/**
 * Through `mediaUrlOf`, so a thumbnail of an image uploaded and not yet
 * published resolves to the patch holding its bytes rather than to the
 * published file, which for a fresh upload is a 404. This catalog builds its
 * URLs in a memo rather than a component, so it takes the lookup as an
 * argument; `useMediaUrl` is the same rule where a hook can be called.
 */
function imageSourceToUrl(
  src: { readonly [key: string]: unknown } | null | undefined,
  filePatchIds: ReadonlyMap<string, string>,
): string | undefined {
  if (!src || typeof src.path !== "string") return undefined;
  return mediaUrlOf({ path: src.path }, filePatchIds) ?? undefined;
}

export function useRichTextEditorConfig(options?: SerializedRichTextOptions): {
  features: Partial<EditorFeatures>;
  linkCatalog: EditorLinkCatalogItem[] | undefined;
  imageModulePath: ModuleFilePath | undefined;
  imageSchema: SerializedImageSchema | undefined;
} {
  const features = useMemo(
    () => serializedRichTextOptionsToFeatures(options),
    [options],
  );

  const isRouteLink =
    options?.a === true ||
    (typeof options?.a === "object" &&
      "type" in options.a &&
      options.a.type === "route");

  const routeSchema =
    isRouteLink &&
    options?.a &&
    typeof options.a === "object" &&
    "type" in options.a &&
    options.a.type === "route"
      ? options.a
      : undefined;

  const includePattern = useMemo(
    () =>
      routeSchema?.options?.include
        ? new RegExp(
            routeSchema.options.include.source,
            routeSchema.options.include.flags,
          )
        : undefined,
    [
      routeSchema?.options?.include?.source,
      routeSchema?.options?.include?.flags,
    ],
  );

  const excludePattern = useMemo(
    () =>
      routeSchema?.options?.exclude
        ? new RegExp(
            routeSchema.options.exclude.source,
            routeSchema.options.exclude.flags,
          )
        : undefined,
    [
      routeSchema?.options?.exclude?.source,
      routeSchema?.options?.exclude?.flags,
    ],
  );

  const routesWithModulePaths = useRoutesWithModulePaths();
  const allPreviews = useAllPreviews();
  const filePatchIds = useFilePatchIds();

  const linkCatalog: EditorLinkCatalogItem[] | undefined = useMemo(() => {
    if (!isRouteLink) return undefined;

    const previewItemsByModule = new Map<
      ModuleFilePath,
      Map<string, { title: string; subtitle?: string | null; image?: string }>
    >();

    return routesWithModulePaths
      .filter(({ route }) => {
        if (includePattern && !includePattern.test(route)) return false;
        if (excludePattern && excludePattern.test(route)) return false;
        return true;
      })
      .map(({ route, moduleFilePath }) => {
        if (!previewItemsByModule.has(moduleFilePath)) {
          const itemMap = new Map<
            string,
            { title: string; subtitle?: string | null; image?: string }
          >();
          const previewAtModule = allPreviews[moduleFilePath];
          if (previewAtModule) {
            const modulePreview = previewAtModule[moduleFilePath];
            if (
              modulePreview &&
              "data" in modulePreview &&
              modulePreview.data &&
              modulePreview.data.rows?.parent === "record"
            ) {
              for (const [key, value] of modulePreview.data.rows.items) {
                itemMap.set(key, {
                  title: value.title,
                  subtitle: value.subtitle,
                  image: imageSourceToUrl(value.image, filePatchIds),
                });
              }
            }
          }
          previewItemsByModule.set(moduleFilePath, itemMap);
        }

        const previewItem = previewItemsByModule
          .get(moduleFilePath)
          ?.get(route);

        if (previewItem) {
          return {
            title: previewItem.title,
            subtitle: previewItem.subtitle ?? moduleFilePath,
            href: route,
            image: previewItem.image,
          };
        }

        return {
          title: route,
          subtitle: moduleFilePath,
          href: route,
        };
      });
  }, [
    isRouteLink,
    routesWithModulePaths,
    includePattern,
    excludePattern,
    allPreviews,
    filePatchIds,
  ]);

  const imageModulePath = useMemo((): ModuleFilePath | undefined => {
    const img = options?.img;
    if (
      img &&
      typeof img === "object" &&
      "type" in img &&
      img.type === "image" &&
      "referencedModule" in img &&
      typeof img.referencedModule === "string"
    ) {
      return img.referencedModule as ModuleFilePath;
    }
    return undefined;
  }, [options]);

  const imageSchema = useMemo((): SerializedImageSchema | undefined => {
    const img = options?.img;
    if (
      img &&
      typeof img === "object" &&
      "type" in img &&
      img.type === "image"
    ) {
      return img as SerializedImageSchema;
    }
    return undefined;
  }, [options]);

  return { features, linkCatalog, imageModulePath, imageSchema };
}
