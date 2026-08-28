import { SourcePath } from "@valbuild/core";
import { ListPreviewItem } from "./ListPreviewItem";
import { Preview } from "./Preview";
import { useRefPreview } from "./useRefPreview";

/**
 * A container item's own preview — title, subtitle, image, as its schema's
 * `preview` produced it — falling back to the generic {@link Preview} of the
 * value when the container declares none.
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
        image={preview.image ?? null}
        subtitle={preview.subtitle ?? null}
        className={className}
        size={size}
      />
    );
  }
  if (className) {
    return (
      <div className={className}>
        <div className="p-2">
          <Preview path={path} size={size} />
        </div>
      </div>
    );
  }
  return (
    <div className="p-2">
      <Preview path={path} size={size} />
    </div>
  );
}
