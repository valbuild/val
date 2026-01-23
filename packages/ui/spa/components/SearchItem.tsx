import { SourcePath } from "@valbuild/core";
import { Preview } from "./Preview";
import { Globe } from "lucide-react";

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
  return <Preview path={path} />;
}
