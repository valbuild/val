import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "./designSystem/cn";
import { DRAG_HANDLE_TOUCH } from "./dragHandle";

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
        /* See `DRAG_HANDLE_TOUCH`. */
        className={cn("pt-4 pr-1", DRAG_HANDLE_TOUCH, { invisible: disabled })}
        disabled={disabled}
      >
        <GripVertical size={16} />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
