import { memo } from "react";
import { SerializedSchema, SourcePath } from "@valbuild/core";
import { AnyField, type ErrorDisplay } from "./AnyField";
import { Field } from "./Field";

/**
 * A field as its container lists it: the label and tools (`Field`) around
 * its input (`AnyField`).
 *
 * One component, and a `memo`, so that a container rendering is not every
 * field in it rendering. A container is woken when anything inside it is
 * written -- its value is a new object -- and it used to hand each `Field` a
 * new `AnyField` element as its children, which no `memo` on `Field` could
 * have held against: typing in a section's title rendered its tagline, its
 * list of bullets and every row of that list
 * (`docs/plans/studio-write-lag.md`).
 *
 * Every prop here is a string, a boolean or the item's schema, which is the
 * same object while the code is. So a field whose own value did not move is
 * not rendered by its container; the one that did is woken by its own read
 * of the store, as it always was.
 *
 * Keep the props to values that are the same while they say the same. A
 * callback or an object made in the container's render is a render of every
 * field in it again.
 */
export const LabeledField = memo(function LabeledField({
  path,
  schema,
  label,
  description,
  readonly,
  compact,
  inline,
  errorDisplay,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  label?: string;
  description?: string;
  readonly?: boolean;
  compact?: boolean;
  inline?: boolean;
  errorDisplay?: ErrorDisplay;
}) {
  return (
    <Field
      label={label}
      description={description}
      path={path}
      type={schema.type}
      readonly={readonly}
      compact={compact}
      errorDisplay={errorDisplay}
    >
      <AnyField
        path={path}
        schema={schema}
        readonly={readonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    </Field>
  );
});
