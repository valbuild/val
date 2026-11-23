import type {
  Json,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Blocks } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "../designSystem/cn";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { useShallowSourceAtPath } from "../ValFieldProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";

/**
 * EXPERIMENTAL: open the value at a path in the Components view - its
 * component, at that use. Given by the shell for a project that has
 * components to show, and `null` anywhere else, where nothing offers it.
 */
export const OpenInComponentsContext = createContext<
  ((path: SourcePath) => void) | null
>(null);

export function useOpenInComponents(): ((path: SourcePath) => void) | null {
  return useContext(OpenInComponentsContext);
}

function isLinked(schema: SerializedSchema): schema is SerializedObjectSchema {
  return schema.type === "object" && schema.render?.as === "component";
}

/**
 * A discreet way from a value's fields to its component: an icon, with a
 * tooltip, beside the field's other tools - shown only for a value whose
 * schema links a component (`.component(...)`), or a union whose variant the
 * value takes does.
 *
 * Read off the schema in hand, and the union's tag where there is one, so a
 * field pays nothing to have it: nothing about the project is subscribed to.
 */
export function ShowInComponentsButton({
  path,
  schema,
  compact = false,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  compact?: boolean;
}) {
  const open = useOpenInComponents();
  if (open === null) return null;
  if (isLinked(schema)) {
    return <ShowButton path={path} open={open} compact={compact} />;
  }
  if (
    schema.type === "discriminated-union" &&
    schema.items.some((item) => isLinked(item))
  ) {
    return (
      <UnionShowButton
        path={path}
        schemaKey={schema.key}
        variants={schema.items}
        open={open}
        compact={compact}
      />
    );
  }
  return null;
}

function UnionShowButton({
  path,
  schemaKey,
  variants,
  open,
  compact,
}: {
  path: SourcePath;
  schemaKey: string;
  variants: SerializedObjectSchema[];
  open: (path: SourcePath) => void;
  compact: boolean;
}) {
  const tagRes = useShallowSourceAtPath(
    sourcePathOfItem(path, schemaKey),
    "literal",
  );
  const tag: Json | undefined = "data" in tagRes ? tagRes.data : undefined;
  const variant = variants.find((item) => {
    const tagSchema = item.items[schemaKey];
    return tagSchema?.type === "literal" && tagSchema.value === tag;
  });
  if (variant === undefined || !isLinked(variant)) return null;
  return <ShowButton path={path} open={open} compact={compact} />;
}

function ShowButton({
  path,
  open,
  compact,
}: {
  path: SourcePath;
  open: (path: SourcePath) => void;
  compact: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => open(path)}
          aria-label="Show in Components"
          className={cn(
            "flex items-center justify-center rounded text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary",
            compact ? "size-5" : "size-6",
          )}
        >
          <Blocks size={compact ? 11 : 13} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Show in Components: this component, with every place it is used
      </TooltipContent>
    </Tooltip>
  );
}
