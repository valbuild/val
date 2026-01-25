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
  type SerializedRichTextOptions as SerializedRichTextOptionsT,
  type SerializedRecordSchema as SerializedRecordSchemaT,
  type SerializedKeyOfSchema as SerializedKeyOfSchemaT,
  type SerializedRouteSchema as SerializedRouteSchemaT,
  type SerializedFileSchema as SerializedFileSchemaT,
  type SerializedDateSchema as SerializedDateSchemaT,
  type SerializedImageSchema as SerializedImageSchemaT,
} from "@valbuild/core";
import { SourcePath } from "./SourcePath";

export const SerializedStringSchema: z.ZodType<SerializedStringSchemaT> =
  z.object({
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

export const SerializedLiteralSchema: z.ZodType<SerializedLiteralSchemaT> =
  z.object({
    type: z.literal("literal"),
    value: z.string(),
    opt: z.boolean(),
  });

export const SerializedBooleanSchema: z.ZodType<SerializedBooleanSchemaT> =
  z.object({
    type: z.literal("boolean"),
    opt: z.boolean(),
  });

export const SerializedNumberSchema: z.ZodType<SerializedNumberSchemaT> =
  z.object({
    type: z.literal("number"),
    options: z
      .object({
        max: z.number().optional(),
        min: z.number().optional(),
      })
      .optional(),
    opt: z.boolean(),
  });

export const SerializedObjectSchema: z.ZodType<SerializedObjectSchemaT> =
  z.lazy(() => {
    return z.object({
      type: z.literal("object"),
      items: z.record(z.string(), SerializedSchema),
      opt: z.boolean(),
    });
  });

export const SerializedArraySchema: z.ZodType<SerializedArraySchemaT> = z.lazy(
  () => {
    return z.object({
      type: z.literal("array"),
      item: SerializedSchema,
      opt: z.boolean(),
    });
  },
);

export const SerializedUnionSchema: z.ZodType<SerializedUnionSchemaT> = z.lazy(
  () => {
    return z.union([
      z.object({
        type: z.literal("union"),
        key: SerializedLiteralSchema,
        items: z.array(SerializedLiteralSchema),
        opt: z.boolean(),
      }),
      z.object({
        type: z.literal("union"),
        key: z.string(),
        items: z.array(SerializedObjectSchema),
        opt: z.boolean(),
      }),
    ]);
  },
);

export const ImageOptions = z.object({
  ext: z
    .union([z.tuple([z.literal("jpg")]), z.tuple([z.literal("webp")])])
    .optional(),
  directory: z.string().optional(),
  prefix: z.string().optional(),
  accept: z.string().optional(),
});
export const SerializedImageSchema: z.ZodType<SerializedImageSchemaT> =
  z.object({
    type: z.literal("image"),
    options: ImageOptions.optional(),
    opt: z.boolean(),
  });

export const RichTextOptions: z.ZodType<SerializedRichTextOptionsT> = z.lazy(
  () =>
    z.object({
      style: z
        .object({
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          lineThrough: z.boolean().optional(),
        })
        .optional(),
      block: z
        .object({
          h1: z.boolean().optional(),
          h2: z.boolean().optional(),
          h3: z.boolean().optional(),
          h4: z.boolean().optional(),
          h5: z.boolean().optional(),
          h6: z.boolean().optional(),
          ul: z.boolean().optional(),
          ol: z.boolean().optional(),
        })
        .optional(),
      inline: z
        .object({
          a: z
            .union([z.boolean(), SerializedRouteSchema, SerializedStringSchema])
            .optional(),
          img: z.union([z.boolean(), SerializedImageSchema]).optional(),
        })
        .optional(),
    }),
);
export const SerializedRichTextSchema: z.ZodType<SerializedRichTextSchemaT> =
  z.object({
    type: z.literal("richtext"),
    options: RichTextOptions.optional(),
    opt: z.boolean(),
  });

export const SerializedRecordSchema: z.ZodType<SerializedRecordSchemaT> =
  z.lazy(() => {
    return z.object({
      type: z.literal("record"),
      item: SerializedSchema,
      opt: z.boolean(),
    });
  });

export const SerializedKeyOfSchema: z.ZodType<SerializedKeyOfSchemaT> = z.lazy(
  () => {
    return z.object({
      type: z.literal("keyOf"),
      path: SourcePath,
      schema: z
        .union([
          z.object({
            type: z.literal("object"),
            keys: z.array(z.string()),
            opt: z.boolean().optional(),
          }),
          z.object({ type: z.literal("record"), opt: z.boolean().optional() }),
        ])
        .optional(),
      values: z.union([z.literal("string"), z.array(z.string())]),
      opt: z.boolean(),
    });
  },
);

export const FileOptions = z.object({
  accept: z.string().optional(),
});
export const SerializedFileSchema: z.ZodType<SerializedFileSchemaT> = z.object({
  type: z.literal("file"),
  options: FileOptions.optional(),
  opt: z.boolean(),
});

export const SerializedDateSchema: z.ZodType<SerializedDateSchemaT> = z.object({
  type: z.literal("date"),
  opt: z.boolean(),
});

export const SerializedRouteSchema: z.ZodType<SerializedRouteSchemaT> =
  z.object({
    type: z.literal("route"),
    options: z
      .object({
        include: z
          .object({
            source: z.string(),
            flags: z.string(),
          })
          .optional(),
        exclude: z
          .object({
            source: z.string(),
            flags: z.string(),
          })
          .optional(),
        customValidate: z.boolean().optional(),
      })
      .optional(),
    opt: z.boolean(),
    customValidate: z.boolean().optional(),
  });

export const SerializedSchema: z.ZodType<SerializedSchemaT> = z.union([
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
  SerializedRouteSchema,
  SerializedFileSchema,
  SerializedDateSchema,
  SerializedImageSchema,
]);
