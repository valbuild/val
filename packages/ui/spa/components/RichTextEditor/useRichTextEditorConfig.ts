import { useMemo } from "react";
import {
  type SerializedRichTextOptions,
  type SerializedImageSchema,
  type ModuleFilePath,
  type ListRecordRender,
  Internal,
  VAL_EXTENSION,
} from "@valbuild/core";
import { useRoutesWithModulePaths } from "../useRoutesOf";
import { useAllRenders } from "../ValFieldProvider";
import { serializedRichTextOptionsToFeatures } from "./convertOptions";
import type { EditorFeatures, EditorLinkCatalogItem } from "./types";

function imageSourceToUrl(
  src: { readonly [key: string]: unknown } | null | undefined,
): string | undefined {
  if (!src) return undefined;
  if (src[VAL_EXTENSION] === "file") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Internal.convertFileSource(src as any).url;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Internal.convertRemoteSource(src as any).url;
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
    options?.inline?.a === true ||
    (typeof options?.inline?.a === "object" &&
      "type" in options.inline.a &&
      options.inline.a.type === "route");

  const routeSchema =
    isRouteLink &&
    options?.inline?.a &&
    typeof options.inline.a === "object" &&
    "type" in options.inline.a &&
    options.inline.a.type === "route"
      ? options.inline.a
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
  const allRenders = useAllRenders();

  const linkCatalog: EditorLinkCatalogItem[] | undefined = useMemo(() => {
    if (!isRouteLink) return undefined;

    const renderItemsByModule = new Map<
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
        if (!renderItemsByModule.has(moduleFilePath)) {
          const itemMap = new Map<
            string,
            { title: string; subtitle?: string | null; image?: string }
          >();
          const renderAtModule = allRenders[moduleFilePath];
          if (renderAtModule) {
            const moduleRender = renderAtModule[moduleFilePath];
            if (
              moduleRender &&
              "data" in moduleRender &&
              moduleRender.data &&
              moduleRender.data.layout === "list" &&
              moduleRender.data.parent === "record"
            ) {
              const recordRender = moduleRender.data as ListRecordRender;
              for (const [key, value] of recordRender.items) {
                itemMap.set(key, {
                  title: value.title,
                  subtitle: value.subtitle,
                  image: imageSourceToUrl(value.image),
                });
              }
            }
          }
          renderItemsByModule.set(moduleFilePath, itemMap);
        }

        const renderItem = renderItemsByModule.get(moduleFilePath)?.get(route);

        if (renderItem) {
          return {
            title: renderItem.title,
            subtitle: renderItem.subtitle ?? moduleFilePath,
            href: route,
            image: renderItem.image,
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
    allRenders,
  ]);

  const imageModulePath = useMemo((): ModuleFilePath | undefined => {
    const img = options?.inline?.img;
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
    const img = options?.inline?.img;
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
