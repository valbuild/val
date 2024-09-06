import { Label } from "./Label";

export function Field({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border border-border rounded-lg p-6">
      {label && <Label>{label}</Label>}
      {children}
    </div>
  );
}
