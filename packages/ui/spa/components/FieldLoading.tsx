import { SerializedSchema, SourcePath } from "@valbuild/core";
import classNames from "classnames";
import { Loader2 } from "lucide-react";

export function FieldLoading({
  path,
  type,
}: {
  path: SourcePath;
  type?: SerializedSchema["type"] | "module";
}) {
  return (
    <div
      id={path}
      className={classNames("pt-6", {
        "w-full flex items-center justify-center": type === "module",
        "text-left": type !== "module",
      })}
    >
      <Loader2 size={type === "module" ? 24 : 16} className="animate-spin" />
    </div>
  );
}
