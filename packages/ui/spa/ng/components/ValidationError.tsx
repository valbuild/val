import { SourcePath } from "@valbuild/core";
import { useErrors } from "../ValProvider";

export function ValidationErrors({ path }: { path: SourcePath }) {
  const { validationErrors } = useErrors();
  const errors = validationErrors[path];
  if (!errors) {
    return null;
  }
  return (
    <div>
      {errors.map((error, i) => (
        <div
          key={i}
          className="p-4 rounded bg-bg-error-primary text-text-primary"
        >
          {error.message}
        </div>
      ))}
    </div>
  );
}
