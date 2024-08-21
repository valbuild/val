import {
  AllRichTextOptions,
  ImageSource,
  Json,
  RichTextSource,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { OnSubmit } from "./SubmitStatus";
import { BooleanField } from "./primitives/BooleanField";
import { DateField } from "./primitives/DateField";
import { FileField } from "./primitives/FileField";
import { ImageField } from "./primitives/ImageField";
import { KeyOfField } from "./primitives/KeyOfField";
import { NumberField } from "./primitives/NumberField";
import { StringUnionField } from "./primitives/StringUnionField";
import { RichTextField } from "./primitives/RichTextField";
import { StringField } from "./primitives/StringField";

export type InitOnSubmit = (path: SourcePath) => OnSubmit;

export function ValFormField({
  path,
  source: source,
  schema: schema,
  initOnSubmit,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
}) {
  const onSubmit = initOnSubmit(path);
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "string"
  ) {
    return (
      <StringField
        path={path}
        source={source}
        schema={schema}
        onSubmit={onSubmit}
      />
    );
  }
  if (
    (typeof source === "number" || source === null) &&
    schema?.type === "number"
  ) {
    return (
      <NumberField
        path={path}
        source={source}
        schema={schema}
        onSubmit={onSubmit}
      />
    );
  }
  if (
    (typeof source === "boolean" || source === null) &&
    schema?.type === "boolean"
  ) {
    return (
      <BooleanField
        path={path}
        defaultValue={source}
        schema={schema}
        onSubmit={onSubmit}
      />
    );
  }
  if (
    (typeof source === "number" ||
      typeof source === "string" ||
      source === null) &&
    schema?.type === "keyOf"
  ) {
    return (
      <KeyOfField
        defaultValue={source}
        onSubmit={onSubmit}
        selector={schema.path}
      />
    );
  }
  if (
    (typeof source === "number" ||
      typeof source === "string" ||
      source === null) &&
    schema?.type === "keyOf"
  ) {
    return (
      <KeyOfField
        defaultValue={source}
        onSubmit={onSubmit}
        selector={schema.path}
      />
    );
  }
  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "richtext"
  ) {
    return (
      <RichTextField
        schema={schema}
        onSubmit={onSubmit}
        defaultValue={source as RichTextSource<AllRichTextOptions>}
      />
    );
  }
  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "image"
  ) {
    return (
      <ImageField
        path={path}
        onSubmit={onSubmit}
        defaultValue={source as ImageSource}
      />
    );
  }

  if (
    (typeof source === "object" || source === null) &&
    schema?.type === "file"
  ) {
    return (
      <FileField
        path={path}
        onSubmit={onSubmit}
        defaultValue={source as ImageSource}
      />
    );
  }
  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "union" &&
    typeof schema.key !== "string"
  ) {
    if (schema.key.type !== "literal") {
      console.error(
        "Val: found union with non-literal key type. Check schema corresponding to path:",
        path
      );
    } else {
      return (
        <StringUnionField
          path={path}
          options={schema.items.flatMap((item) =>
            item.type === "literal" ? [item.value] : []
          )}
          onSubmit={onSubmit}
          defaultValue={source}
        />
      );
    }
  }

  if (
    (typeof source === "string" || source === null) &&
    schema?.type === "date"
  ) {
    return (
      <DateField
        path={path}
        defaultValue={source}
        onSubmit={onSubmit}
        schema={schema}
      />
    );
  }

  console.warn(
    `Unsupported schema: ${
      schema.type
    } (source type: ${typeof source}) source:`,
    source
  );
  throw Error(
    `Unsupported schema: ${schema.type} (source type: ${typeof source}) source:`
  );
}
