import { SourcePath } from "@valbuild/core";
import { Globe } from "lucide-react";
import { ListPreviewItem } from "./ListPreviewItem";
import { Preview } from "./Preview";
import { NodeIcon } from "./NodeIcon";
import { useSchemaAtPath } from "./ValFieldProvider";
import { useDescription } from "./useDescription";
import { cn } from "./designSystem/cn";

/**
 * One search hit: what it is on top, what it is called underneath.
 *
 * The top line is provenance and stays whatever the description says — in
 * search, two hits in the same module are told apart by their path and by
 * nothing else, and a page is told apart by its URL. It used to be the ONLY
 * line with any identity in it, because the row below fell back to a dump of
 * whatever the value happened to contain.
 *
 * The row below is now the same name the value has in the nav, in a reference
 * and in the heading you land on when you click it — a hit you cannot recognise
 * is a hit you do not click.
 */
export function SearchItem({
  path,
  size,
}: {
  path: SourcePath;
  size?: "compact";
}) {
  const description = useDescription(path);
  const schemaAtPath = useSchemaAtPath(path);
  const schemaType =
    "data" in schemaAtPath && schemaAtPath.data
      ? schemaAtPath.data.type
      : "loading";
  const isPage = description.url !== null;
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2 text-sm text-fg-tertiary min-w-0">
        {isPage ? (
          <Globe size={12} />
        ) : (
          <NodeIcon type={schemaType} size={12} />
        )}
        <span className="truncate">
          {/*
           * The route for a page, the key or index for anything else — the same
           * `#3` / `blog_1` / `Hero Title` the rest of the studio shows, rather
           * than this component's own reading of the path.
           */}
          {description.url ?? description.pathLabel}
        </span>
      </div>
      {description.origin.title === "preview" ? (
        <ListPreviewItem
          title={description.title}
          subtitle={description.subtitle}
          image={description.image ?? undefined}
          size={size}
        />
      ) : (
        // Nobody named this value, so the name would be the line above again.
        // The generic per-type preview says more than a repetition would.
        <div className={cn("p-2")}>
          <Preview path={path} size={size} />
        </div>
      )}
    </div>
  );
}
