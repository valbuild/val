import { SourcePath } from "@valbuild/core";
import { ValidationError } from "@valbuild/core";
import { TriangleAlert } from "lucide-react";
import { useNavigation } from "./ValRouter";
import { useAllValidationErrors } from "./ValErrorProvider";

/**
 * Shell for the dedicated validation errors page (`/val/errors`).
 * The visible errors are driven by repeated `error-field=` query params.
 * Real layout lands in a follow-up commit.
 */
export function ValidationErrors({
  errorFields,
  allErrors,
}: {
  errorFields: SourcePath[];
  allErrors: Record<SourcePath, ValidationError[] | undefined> | null;
}) {
  if (errorFields.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-sm text-fg-secondary">
        No errors selected.
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl flex flex-col gap-4 py-6">
      <header className="flex items-center gap-2">
        <TriangleAlert size={16} className="text-fg-error" />
        <h1 className="text-lg font-medium text-fg-primary">
          Validation errors
        </h1>
        <span className="text-sm text-fg-secondary">
          {errorFields.length}{" "}
          {errorFields.length === 1 ? "field" : "fields"}
        </span>
      </header>
      <ul className="flex flex-col gap-3">
        {errorFields.map((path) => {
          const errors = allErrors?.[path];
          return (
            <li
              key={path}
              className="rounded border border-border-primary bg-bg-primary px-4 py-3"
            >
              <div className="font-mono text-xs text-fg-secondary truncate">
                {path}
              </div>
              {errors && errors.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-sm text-fg-primary">
                  {errors.map((err, i) => (
                    <li key={i}>{err.message}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-fg-tertiary">
                  No active error at this path.
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ValidationErrorsView() {
  const { errorFields } = useNavigation();
  const allErrors = useAllValidationErrors();
  return <ValidationErrors errorFields={errorFields} allErrors={allErrors} />;
}
