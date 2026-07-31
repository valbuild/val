import { SerializedSchema, SourcePath } from "@valbuild/core";
import { AnyField } from "./AnyField";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "./designSystem/cn";

export function InlineAnyField({
  path,
  schema,
  readonly,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  readonly: boolean;
}) {
  return (
    <AnyField path={path} schema={schema} readonly={readonly} compact inline />
  );
}

export function InlineSortableItem({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled: disabled === true });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <button
        {...attributes}
        {...listeners}
        className={cn("pt-4 pr-1", { invisible: disabled })}
        disabled={disabled}
      >
        <GripVertical size={16} />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
