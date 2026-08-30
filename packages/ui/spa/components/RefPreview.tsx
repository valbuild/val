import { SourcePath } from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { ListPreviewItem } from "./ListPreviewItem";
import { Preview } from "./Preview";
import { useRefPreview } from "./useRefPreview";

/**
 * A value's preview — title, subtitle, image, as its schema's `preview`
 * produced it — falling back to the generic {@link Preview} of the value when
 * no preview is declared for it.
 *
 * The two branches are meant to look different: a declared preview gets the
 * compact media row in {@link ListPreviewItem}, which is laid out for the
 * shape we know it has, and everything else gets the generic per-type dump.
 * Both are padded the same (`p-2`, once) so a list does not change density
 * row by row depending on which branch each row took.
 */
export function RefPreview({
  path,
  className,
  size,
}: {
  path: SourcePath;
  className?: string;
  size?: "compact";
}) {
  const preview = useRefPreview(path);

  if (preview) {
    return (
      <ListPreviewItem
        title={preview.title}
        // Passed through rather than coalesced: `undefined` (no image in the
        // preview) and `null` (an image this value does not have) lay the row
        // out differently. See ListPreviewItem.
        image={preview.image}
        subtitle={preview.subtitle ?? null}
        className={className}
        size={size}
      />
    );
  }
  return (
    <div className={cn("p-2", className)}>
      <Preview path={path} size={size} />
    </div>
  );
}
