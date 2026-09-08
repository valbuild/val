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
  type SerializedDateTimeSchema as SerializedDateTimeSchemaT,
  type SerializedColorSchema as SerializedColorSchemaT,
  type SerializedCodeSchema as SerializedCodeSchemaT,
  type SerializedImageSchema as SerializedImageSchemaT,
  type SerializedSettingsSchema as SerializedSettingsSchemaT,
  CODE_LANGUAGES,
} from "@valbuild/core";
import { SourcePath } from "./SourcePath";

// A render is static config, so unlike a `preview` it travels WHOLE — this
// is the field the editor reads the layout from. See `core/src/render.ts`.
// Every field can carry `{ as: "inline" }`, and that is all a render says.
// NB: these z.objects STRIP unknown keys, so a render variant that is not
// declared here is silently dropped in transit — add it here when it is added
// to `render.ts`.
const InlineRender = z.object({ as: z.literal("inline") });
const FieldRender = InlineRender.optional();

/**
 * The fields EVERY serialized schema carries, in one place.
 *
 * Spread into each schema below rather than retyped, because retyping them is
 * exactly how they went missing: `customValidate` and `description` were
 * declared on six of the eighteen schemas and silently dropped by the other
 * twelve. A field added to the base of `SerializedSchema` needs adding here and
 * nowhere else.
 *
 * `type`, `opt` and whatever is particular to the schema stay at the call site
 * - those differ per schema, so there is nothing to share.
 */
const commonSchemaFields = {
  render: FieldRender,
  preview: z.literal(true).optional(),
  // Whether the schema declares a `.validate()`. The function cannot serialize,
  // so this flag is what tells the Studio to run the custom validators on the
  // main thread against the real instance - dropped, and they never run at all.
  // See `hasCustomValidate` in `ui/spa/validation/customValidate.ts`.
  customValidate: z.boolean().optional(),
  readonly: z.boolean().optional(),
  hidden: z.boolean().optional(),
  description: z.string().optional(),
};

export const SerializedStringSchema: z.ZodType<SerializedStringSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("string"),
    // `.multiline()`. Stripped like any undeclared key if it goes missing here,
    // which is a single-line input where the author asked for a text box.
    multiline: z.boolean().optional(),
    options: z
      .object({
        maxLength: z.number().optional(),
        minLength: z.number().optional(),
        regexp: z
          .object({
            // `.regexp(re, message)`'s message. Written by
            // `StringSchema.executeSerialize`, so omitting it here strips the
            // author's own wording and leaves the generic "Expected string to
            // match reg exp: …" in its place.
            message: z.string().optional(),
            source: z.string(),
            flags: z.string(),
          })
          .optional(),
        customValidate: z.boolean().optional(),
      })
      .optional(),
    opt: z.boolean(),
    raw: z.boolean(),
  });

export const SerializedLiteralSchema: z.ZodType<SerializedLiteralSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("literal"),
    value: z.string(),
    opt: z.boolean(),
  });

export const SerializedBooleanSchema: z.ZodType<SerializedBooleanSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("boolean"),
    opt: z.boolean(),
  });

export const SerializedNumberSchema: z.ZodType<SerializedNumberSchemaT> =
  z.object({
    ...commonSchemaFields,
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
      ...commonSchemaFields,
      type: z.literal("object"),
      items: z.record(z.string(), SerializedSchema),
      opt: z.boolean(),
    });
  });

export const SerializedArraySchema: z.ZodType<SerializedArraySchemaT> = z.lazy(
  () => {
    return z.object({
      ...commonSchemaFields,
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
        ...commonSchemaFields,
        type: z.literal("union"),
        key: SerializedLiteralSchema,
        items: z.array(SerializedLiteralSchema),
        opt: z.boolean(),
      }),
      z.object({
        ...commonSchemaFields,
        type: z.literal("union"),
        key: z.string(),
        items: z.array(SerializedObjectSchema),
        opt: z.boolean(),
      }),
    ]);
  },
);

export const ImageEncodeOption = z.union([
  z.literal(false),
  z.object({
    type: z.literal("webp"),
    quality: z.number().optional(),
    maxWidth: z.number().optional(),
    maxHeight: z.number().optional(),
  }),
]);
export const ImageOptions = z.object({
  directory: z.string().optional(),
  accept: z.string().optional(),
  encode: ImageEncodeOption.optional(),
});
export const SerializedImageSchema: z.ZodType<SerializedImageSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("image"),
    options: ImageOptions.optional(),
    opt: z.boolean(),
    // `.remote()`, and the gallery a gallery-backed field reads its metadata
    // from. Neither is cosmetic: dropped, a remote field looks local and a
    // gallery-backed one looks like it holds its own dimensions.
    remote: z.boolean().optional(),
    referencedModule: z.string().optional(),
  });

export const RichTextOptions: z.ZodType<SerializedRichTextOptionsT> = z.lazy(
  () =>
    z.object({
      // Set by `.maxLength()` / `.minLength()`, not by the options argument.
      // These z.objects strip unknown keys, so leaving them out drops the
      // length constraints in transit.
      maxLength: z.number().optional(),
      minLength: z.number().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      lineThrough: z.boolean().optional(),
      h1: z.boolean().optional(),
      h2: z.boolean().optional(),
      h3: z.boolean().optional(),
      h4: z.boolean().optional(),
      h5: z.boolean().optional(),
      h6: z.boolean().optional(),
      ul: z.boolean().optional(),
      ol: z.boolean().optional(),
      a: z
        .union([z.boolean(), SerializedRouteSchema, SerializedStringSchema])
        .optional(),
      img: z.union([z.boolean(), SerializedImageSchema]).optional(),
    }),
);
export const SerializedRichTextSchema: z.ZodType<SerializedRichTextSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("richtext"),
    options: RichTextOptions.optional(),
    opt: z.boolean(),
  });

export const SerializedRecordSchema: z.ZodType<SerializedRecordSchemaT> =
  z.lazy(() => {
    return z
      .object({
        ...commonSchemaFields,
        type: z.literal("record"),
        item: SerializedSchema,
        opt: z.boolean(),
        // Optional gallery marker for files/images
        mediaType: z
          .union([z.literal("files"), z.literal("images")])
          .optional(),
        // Optional legacy gallery metadata
        accept: z.string().optional(),
        directory: z.string().optional(),
        remote: z.boolean().optional(),
        encode: ImageEncodeOption.optional(),
        alt: SerializedSchema.optional(),
        moduleMetadata: z
          .record(z.string(), z.record(z.string(), z.any()))
          .optional(),
      })
      .passthrough();
  });

export const SerializedKeyOfSchema: z.ZodType<SerializedKeyOfSchemaT> = z.lazy(
  () => {
    return z.object({
      ...commonSchemaFields,
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
  ...commonSchemaFields,
  type: z.literal("file"),
  options: FileOptions.optional(),
  opt: z.boolean(),
  // See `SerializedImageSchema` above: `.remote()` and the gallery a
  // gallery-backed field reads from.
  remote: z.boolean().optional(),
  referencedModule: z.string().optional(),
});

export const DateOptions = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const SerializedDateSchema: z.ZodType<SerializedDateSchemaT> = z.object({
  ...commonSchemaFields,
  type: z.literal("date"),
  options: DateOptions.optional(),
  opt: z.boolean(),
});

export const SerializedDateTimeSchema: z.ZodType<SerializedDateTimeSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("dateTime"),
    options: DateOptions.optional(),
    opt: z.boolean(),
  });

export const ColorOptions = z.object({
  format: z.enum(["hex", "rgb", "hsl", "oklch"]).optional(),
  alpha: z.boolean().optional(),
});

export const SerializedColorSchema: z.ZodType<SerializedColorSchemaT> =
  z.object({
    ...commonSchemaFields,
    type: z.literal("color"),
    options: ColorOptions.optional(),
    opt: z.boolean(),
  });

export const CodeOptions = z.object({
  language: z.enum(CODE_LANGUAGES).optional(),
});

export const SerializedCodeSchema: z.ZodType<SerializedCodeSchemaT> = z.object({
  ...commonSchemaFields,
  type: z.literal("code"),
  options: CodeOptions.optional(),
  opt: z.boolean(),
});

export const SerializedRouteSchema: z.ZodType<SerializedRouteSchemaT> =
  z.object({
    ...commonSchemaFields,
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
  });

// A settings module, and each section inside one, serialize as this - the
// shape is recursive because `items` holds sections which are themselves
// settings schemas. `s.settings()` never writes render/preview/customValidate
// (see core/src/schema/settings.ts), but they are accepted here because they
// are part of the declared type.
export const SerializedSettingsSchema: z.ZodType<SerializedSettingsSchemaT> =
  z.lazy(() => {
    return z.object({
      ...commonSchemaFields,
      type: z.literal("settings"),
      items: z.record(z.string(), SerializedSchema),
      opt: z.boolean(),
    });
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
  SerializedDateTimeSchema,
  SerializedColorSchema,
  SerializedCodeSchema,
  SerializedSettingsSchema,
  SerializedImageSchema,
]);
