import { SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import { useErrorsOfPath, ValError } from "../UIProvider";
import { Remote } from "../../utils/Remote";
import classNames from "classnames";
import { ShieldAlert } from "lucide-react";

export function Field({
  label,
  children,
  path,
}: {
  label?: string;
  children: React.ReactNode;
  path: SourcePath;
}) {
  const errors = useErrorsOfPath(path);
  const hasErrors = errors.status === "success" && errors.data.length > 0;
  return (
    <div
      className={classNames("flex flex-col gap-4 p-6 border rounded-lg", {
        "border-destructive": hasErrors,
        "border-border": !hasErrors,
      })}
    >
      {label && <Label>{label}</Label>}
      {children}
      <FieldError errors={errors} />
    </div>
  );
}

export function FieldError({ errors }: { errors: Remote<ValError[]> }) {
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
