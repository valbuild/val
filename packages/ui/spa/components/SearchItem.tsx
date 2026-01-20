import { SourcePath } from "@valbuild/core";
import { useParent } from "../hooks/useParent";
import { Preview } from "./Preview";
import { Globe } from "lucide-react";

export function SearchItem({ path }: { path: SourcePath }) {
  const { path: parentPath, schema: parentSchema } = useParent(path);
  const isRouterPage =
    parentPath !== path &&
    parentSchema?.type === "record" &&
    Boolean(parentSchema?.router);

  if (isRouterPage) {
    return (
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-fg-tertiary shrink-0" />
        <div className="flex-1 min-w-0">
          <Preview path={path} />
        </div>
      </div>
    );
  }

  return <Preview path={path} />;
}
