import { SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import { describePath, Description } from "../utils/describePath";
import { useParent } from "../hooks/useParent";
import { useSchemaAtPath } from "./ValFieldProvider";
import { useRefPreview } from "./useRefPreview";

/**
 * What this path is called, here and everywhere else.
 *
 * The hook half of {@link describePath}: it fetches the three things the pure
 * function needs — the value's preview, its schema and its parent's — and gets
 * out of the way. Anything that shows a path to a human should call this rather
 * than re-deriving a label from the path; see {@link Description}.
 *
 * KNOWN GAP, until `executePreview` emits a self preview: `useRefPreview`
 * resolves a value's preview out of its CONTAINER's reified rows, so a value
 * with no container — a module root — cannot have one, and a module's own
 * `.preview(...)` is never run. Such a path falls back to its file name, which
 * is what the studio shows today, so this hook is correct now and gets better
 * without its callers changing. See `core/src/preview.ts`.
 */
export function useDescription(path: SourcePath): Description {
  const preview = useRefPreview(path);
  const schemaAtPath = useSchemaAtPath(path);
  const { schema: parentSchema } = useParent(path);
  const schema = "data" in schemaAtPath ? schemaAtPath.data : undefined;
  return useMemo(
    () => describePath({ path, preview, schema, parentSchema }),
    [path, preview, schema, parentSchema],
  );
}
