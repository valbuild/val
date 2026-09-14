import { PreviewItem, SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { describePath, Description } from "../utils/describePath";
import { useParent } from "../hooks/useParent";
import { usePreviewAtPath, useSchemaAtPath } from "./ValFieldProvider";
import { useRefPreview } from "./useRefPreview";

/**
 * What this path is called, here and everywhere else.
 *
 * The hook half of {@link describePath}: it fetches the three things the pure
 * function needs — the value's preview, its schema and its parent's — and gets
 * out of the way. Anything that shows a path to a human should call this rather
 * than re-deriving a label from the path; see {@link Description}.
 *
 * A preview reaches a path by one of two routes, and which one depends on
 * whether the value has a container:
 *
 * - **Its own `self`**, for a module root or a field of an object — anything
 *   that is nobody's row. Nothing reified these before `executePreview` learned
 *   to emit a self preview, which is why a module's own `.preview(...)` used to
 *   do nothing at all.
 * - **Its container's `rows`**, for an item of an array or record. Deliberately
 *   NOT also a self: it is one closure, and running it once per row is the
 *   whole point of the scoped preview work. `useRefPreview` is the lookup.
 *
 * They cannot both be present, so the order below is a preference in name
 * only.
 */
export function useDescription(path: SourcePath): Description {
  const own = useSelfPreview(path);
  const fromContainer = useRefPreview(path);
  const schemaAtPath = useSchemaAtPath(path);
  const { schema: parentSchema } = useParent(path);
  const schema = "data" in schemaAtPath ? schemaAtPath.data : undefined;
  const preview = own ?? fromContainer;
  return useMemo(
    () => describePath({ path, preview, schema, parentSchema }),
    [path, preview, schema, parentSchema],
  );
}

/** What this value's OWN schema's `.preview(...)` produced for it, if anything. */
export function useSelfPreview(path: SourcePath): PreviewItem | undefined {
  const previewAtPath = usePreviewAtPath(path);
  if (
    !previewAtPath ||
    !("data" in previewAtPath) ||
    previewAtPath.data === undefined
  ) {
    return undefined;
  }
  return previewAtPath.data.self;
}
