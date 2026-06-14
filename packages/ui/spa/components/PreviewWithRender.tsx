import { SourcePath } from "@valbuild/core";
import { ListPreviewItem } from "./ListPreviewItem";
import { Preview } from "./Preview";
import { useRefPreview } from "./useRefPreview";

export function PreviewWithRender({
  path,
  className,
  size,
}: {
  path: SourcePath;
  className?: string;
  size?: "compact";
}) {
  const render = useRefPreview(path);

  if (render) {
    return (
      <ListPreviewItem
        title={render.title}
        image={render.image ?? null}
        subtitle={render.subtitle ?? null}
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
