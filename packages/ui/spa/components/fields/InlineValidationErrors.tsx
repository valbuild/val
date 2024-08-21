import { ValidationError } from "@valbuild/core";

export function InlineValidationErrors({
  errors,
}: {
  errors: ValidationError[];
}) {
  return (
    <div className="flex flex-col p-2 text-sm rounded-md gap-y-1 text-destructive-foreground bg-destructive">
      {errors.map((error, i) => (
        <div key={i}>{error.message}</div>
      ))}
    </div>
  );
}
