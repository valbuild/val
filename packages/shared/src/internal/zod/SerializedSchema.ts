import { z } from "zod";
import {
  type SerializedSchema as SerializedSchemaT,
  type SerializedStringSchema as SerializedStringSchemaT,
  type SerializedLiteralSchema as SerializedLiteralSchemaT,
  type SerializedBooleanSchema as SerializedBooleanSchemaT,
  type SerializedNumberSchema as SerializedNumberSchemaT,
  type SerializedObjectSchema as SerializedObjectSchemaT,
  type SerializedArraySchema as SerializedArraySchemaT,
  type SerializedUnionSchema as SerializedUnionSchemaT,
  type SerializedRichTextSchema as SerializedRichTextSchemaT,
  type RichTextOptions as RichTextOptionsT,
  type SerializedRecordSchema as SerializedRecordSchemaT,
  type SerializedKeyOfSchema as SerializedKeyOfSchemaT,
  type SerializedFileSchema as SerializedFileSchemaT,
  type SerializedDateSchema as SerializedDateSchemaT,
  type SerializedImageSchema as SerializedImageSchemaT,
} from "@valbuild/core";
import { SourcePath } from "./SourcePath";

export const SerializedStringSchema: z.ZodType<
  SerializedStringSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("string"),
  options: z
    .object({
      maxLength: z.number().optional(),
      minLength: z.number().optional(),
      regexp: z
        .object({
          source: z.string(),
          flags: z.string(),
        })
        .optional(),
    })
    .optional(),
  opt: z.boolean(),
  raw: z.boolean(),
});

export const SerializedLiteralSchema: z.ZodType<
  SerializedLiteralSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("literal"),
  value: z.string(),
  opt: z.boolean(),
});

export const SerializedBooleanSchema: z.ZodType<
  SerializedBooleanSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("boolean"),
  opt: z.boolean(),
});

export const SerializedNumberSchema: z.ZodType<
  SerializedNumberSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("number"),
  options: z
    .object({
      max: z.number().optional(),
      min: z.number().optional(),
    })
    .optional(),
  opt: z.boolean(),
});

export const SerializedObjectSchema: z.ZodType<
  SerializedObjectSchemaT,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => {
  return z.object({
    type: z.literal("object"),
    items: z.record(SerializedSchema),
    opt: z.boolean(),
  });
});

export const SerializedArraySchema: z.ZodType<
  SerializedArraySchemaT,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => {
  return z.object({
    type: z.literal("array"),
    item: SerializedSchema,
    opt: z.boolean(),
  });
});

export const SerializedUnionSchema: z.ZodType<
  SerializedUnionSchemaT,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => {
  return z.object({
    type: z.literal("union"),
    key: z.union([z.string(), SerializedSchema]),
    items: z.array(SerializedSchema),
    opt: z.boolean(),
  });
});

export const RichTextOptions: z.ZodType<
  RichTextOptionsT,
  z.ZodTypeDef,
  unknown
> = z.object({
  style: z.object({
    bold: z.boolean(),
    italic: z.boolean(),
    lineThrough: z.boolean(),
  }),
  block: z.object({
    h1: z.boolean(),
    h2: z.boolean(),
    h3: z.boolean(),
    h4: z.boolean(),
    h5: z.boolean(),
    h6: z.boolean(),
    ul: z.boolean(),
    ol: z.boolean(),
  }),
  inline: z.object({
    a: z.boolean(),
    img: z.boolean(),
  }),
});
export const SerializedRichTextSchema: z.ZodType<
  SerializedRichTextSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("richtext"),
  options: RichTextOptions,
  opt: z.boolean(),
});

export const SerializedRecordSchema: z.ZodType<
  SerializedRecordSchemaT,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => {
  return z.object({
    type: z.literal("record"),
    item: SerializedSchema,
    opt: z.boolean(),
  });
});

export const SerializedKeyOfSchema: z.ZodType<
  SerializedKeyOfSchemaT,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => {
  return z.object({
    type: z.literal("keyOf"),
    path: SourcePath,
    schema: SerializedSchema,
    values: z.union([
      z.literal("string"),
      z.literal("number"),
      z.array(z.string()),
    ]),
    opt: z.boolean(),
  });
});

export const FileOptions = z.record(z.never());
export const SerializedFileSchema: z.ZodType<
  SerializedFileSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("file"),
  options: FileOptions.optional(),
  opt: z.boolean(),
});

export const SerializedDateSchema: z.ZodType<
  SerializedDateSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("date"),
  opt: z.boolean(),
});

export const ImageOptions = z.object({
  ext: z.union([z.tuple([z.literal("jpg")]), z.tuple([z.literal("webp")])]),
  directory: z.string().optional(),
  prefix: z.string().optional(),
});
export const SerializedImageSchema: z.ZodType<
  SerializedImageSchemaT,
  z.ZodTypeDef,
  unknown
> = z.object({
  type: z.literal("image"),
  options: ImageOptions.optional(),
  opt: z.boolean(),
});

export const SerializedSchema: z.ZodType<
  SerializedSchemaT,
  z.ZodTypeDef,
  unknown
> = z.union([
  SerializedStringSchema,
  SerializedLiteralSchema,
  SerializedBooleanSchema,
  SerializedNumberSchema,
  SerializedObjectSchema,
  SerializedArraySchema,
  SerializedUnionSchema,
  SerializedRichTextSchema,
  SerializedRecordSchema,
  SerializedKeyOfSchema,
  SerializedFileSchema,
  SerializedDateSchema,
  SerializedImageSchema,
]);
