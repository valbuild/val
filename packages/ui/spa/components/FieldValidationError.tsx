import { SourcePath, ValidationError } from "@valbuild/core";
import classNames from "classnames";
import { AlertTriangle, Loader2 } from "lucide-react";
import { FieldErrorList } from "./FieldErrorList";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import {
  useAllSources,
  useLoadingStatus,
  useSchemas,
} from "./ValFieldProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useNavigation } from "./ValRouter";
import { getNavPathFromAll } from "./getNavPath";

/**
 * Inline error display rendered below a field in the editor.
 *
 * The visual style is owned by `FieldErrorList` and is shared with the
 * `/val/errors` page so the same field reads identically in both views.
 */
export function FieldValidationError({
  validationErrors,
}: {
  validationErrors: ValidationError[];
}) {
  if (validationErrors.length === 0) {
    return null;
  }
  return (
    <div className="w-full pt-2">
      <FieldErrorList validationErrors={validationErrors} />
    </div>
  );
}

export function FieldValidationErrorCompact({ path }: { path: SourcePath }) {
  const { navigate } = useNavigation();
  const schemas = useSchemas();
  const allSources = useAllSources();
  const validationErrors = useAllValidationErrors();
  const loadingStatus = useLoadingStatus();
  const isLoading = loadingStatus === "loading";
  const messages: string[] = [];
  if (validationErrors) {
    for (const errorPath in validationErrors) {
      if (errorPath.startsWith(path)) {
        for (const err of validationErrors[errorPath as SourcePath] ?? []) {
          messages.push(err.message);
        }
      }
    }
  }
  if (messages.length === 0) return <div className="size-6 shrink-0" />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => {
            const schemasData =
              schemas.status === "success" ? schemas.data : undefined;
            const navPath = getNavPathFromAll(path, allSources, schemasData);
            navigate(navPath ?? path, {
              scrollToPath: path,
            });
          }}
          className={classNames(
            "inline-flex items-center justify-center size-6 rounded bg-bg-error-secondary text-fg-error hover:bg-bg-error-primary transition-colors",
            { "opacity-80": isLoading },
          )}
          aria-label="Go to validation error"
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <AlertTriangle size={16} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        className="max-w-xs bg-bg-error-secondary text-fg-error border-fg-error/20"
      >
        {messages.length === 1 ? (
          <p className="text-xs">{messages[0]}</p>
        ) : (
          <ul className="text-xs list-disc pl-3 space-y-0.5">
            {messages.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
