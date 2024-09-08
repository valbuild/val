import { SourcePath } from "@valbuild/core";
import { Label } from "./Label";

export function Field({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
  path: SourcePath;
}) {
  return (
    <div className="flex flex-col gap-4 p-6 border rounded-lg border-border">
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}
