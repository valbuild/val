import { SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import {
  PatchWithMetadata,
  useErrorsOfPath,
  usePatchesOfPath,
  ValError,
} from "../UIProvider";
import { Remote } from "../../utils/Remote";
import classNames from "classnames";
import { ChevronDown, ChevronsDown, ShieldAlert } from "lucide-react";
import { relativeLocalDate } from "../relativeLocalDate";
import { useMemo, useState } from "react";
import { AnimateHeight } from "./AnimateHeight";

export function Field({
  label,
  children,
  path,
  transparent,
  foldLevel = "1",
}: {
  label?: string | React.ReactNode;
  children: React.ReactNode;
  path: SourcePath;
  transparent?: boolean;
  foldLevel?: "2" | "1";
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const errors = useErrorsOfPath(path);
  const patches = usePatchesOfPath(path);
  const hasErrors = errors.status === "success" && errors.data.length > 0;
  const hasPatches = patches.status === "success" && patches.data.length > 0;
  return (
    <div
      className={classNames("flex flex-col gap-6 p-4 border rounded-lg", {
        "border-destructive": hasErrors,
        "border-accent": !hasErrors && hasPatches,
        "border-border": !hasErrors && !hasPatches,
        "bg-primary-foreground": !transparent,
      })}
    >
      <div className="flex justify-between">
        {typeof label === "string" && <Label>{label}</Label>}
        {label && typeof label !== "string" && label}
        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          className={classNames("transform transition-transform", {
            "rotate-180": isExpanded,
          })}
        >
          {foldLevel === "1" && <ChevronDown size={16} />}
          {foldLevel === "2" && <ChevronsDown size={16} />}
        </button>
      </div>
      <AnimateHeight isOpen={isExpanded}>
        <div className="flex flex-col gap-6">{children}</div>
      </AnimateHeight>
      <FieldError errors={errors} />
      <FieldChanges patches={patches} />
    </div>
  );
}

function FieldError({ errors }: { errors: Remote<ValError[]> }) {
  if (errors.status === "success" && errors.data.length > 0) {
    return (
      <div className="flex items-start gap-1 text-sm text-destructive">
        <div className="relative flex items-center justify-center w-6 h-6 rounded-lg">
          <div className="absolute w-full h-full bg-destructive opacity-10"></div>
          {/* hack to work around bg-opacity not working (is it var(hsl...) that causes this?) */}
          <ShieldAlert size={16} />
        </div>
        <div className="flex flex-col gap-y-4">
          {errors.data.map((error, index) => (
            <div key={index}>{error.message}</div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function FieldChanges({ patches }: { patches: Remote<PatchWithMetadata[]> }) {
  const now = useMemo(() => new Date(), []);
  if (patches.status === "success" && patches.data.length > 0) {
    const lastDate = patches.data
      .map((patch) => new Date(patch.created_at))
      .sort()?.[0]
      ?.toISOString();
    const author = patches.data.map((patch) => patch.author)[0]; // TODO: create multiple overlapping avatar images
    return (
      <div className="flex justify-end gap-2 text-accent">
        <img
          src={author.avatar}
          className="object-cover w-6 h-6 rounded-full"
        />
        {lastDate && <span>{relativeLocalDate(now, lastDate)}</span>}
      </div>
    );
  }
}
