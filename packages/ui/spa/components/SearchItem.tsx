import { SourcePath } from "@valbuild/core";
import { Globe } from "lucide-react";
import { PreviewWithRender } from "./PreviewWithRender";

export function SearchItem({
  path,
  url,
}: {
  path: SourcePath;
  url: string | null;
}) {
  if (url) {
    return (
      <div className="flex items-center gap-2 w-full justify-between">
        <Globe />
        <span>{url}</span>
      </div>
    );
  }
  return <PreviewWithRender path={path} />;
}
