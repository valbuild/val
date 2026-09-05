import { useMemo } from "react";
import {
  type SerializedRichTextOptions,
  type SerializedImageSchema,
  type ModuleFilePath,
  Internal,
} from "@valbuild/core";
import { useRoutesWithModulePaths } from "../useRoutesOf";
import { useAllPreviews } from "../ValFieldProvider";
import { serializedRichTextOptionsToFeatures } from "./convertOptions";
import type { EditorFeatures, EditorLinkCatalogItem } from "./types";

function imageSourceToUrl(
  src: { readonly [key: string]: unknown } | null | undefined,
): string | undefined {
  if (!src || typeof src.path !== "string") return undefined;
  return Internal.mediaUrl({ path: src.path });
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
              modulePreview.data.parent === "record"
            ) {
              for (const [key, value] of modulePreview.data.items) {
                itemMap.set(key, {
                  title: value.title,
                  subtitle: value.subtitle,
                  image: imageSourceToUrl(value.image),
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
