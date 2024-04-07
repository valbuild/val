export default {};
// TODO:
// import type { SerializedSchema as SerializedSchemaT } from "@valbuild/core";
// import { z } from "zod";
//
// export const SerializedSchema: z.ZodType<SerializedSchemaT> = z.lazy(() => {
//   const SerializedStringSchema = z.object({
//     _type: z.literal("string"),
//     opt: z.boolean(),
//   });
//   const SerializedBooleanSchema = z.object({
//     _type: z.literal("boolean"),
//     opt: z.boolean(),
//   });
//   const SerializedNumberSchema = z.object({
//     _type: z.literal("number"),
//     opt: z.boolean(),
//   });
//   const SerializedLiteralSchema = z.object({
//     _type: z.literal("literal"),
//     value: z.string(),
//     opt: z.boolean(),
//   });
//   const SerializedObjectSchema = z.object({
//     _type: z.literal("object"),
//     opt: z.boolean(),
//     items: z.record(SerializedSchema),
//   });
//   const SerializedOneOfSchema = z.object({
//     _type: z.literal("oneOf"),
//     opt: z.boolean(),
//   });
//   const SerializedArraySchema = z.object({
//     _type: z.literal("array"),
//     item: SerializedSchema,
//     opt: z.boolean(),
//   });
//   const SerializedUnionSchema = z.object({
//     _type: z.literal("union"),
//     opt: z.boolean(),
//   });
//   const SerializedRichTextSchema = z.object({
//     _type: z.literal("richtext"),
//     opt: z.boolean(),
//   });
//   const SerializedImageSchema = z.object({
//     _type: z.literal("image"),
//     opt: z.boolean(),
//   });
//   const SerializedI18nSchema = z.object({
//     _type: z.literal("i18n"),
//     locales: z.array(z.string()),
//     item: SerializedSchema,
//     opt: z.boolean(),
//   });
//   return z.union([
//     SerializedStringSchema,
//     SerializedLiteralSchema,
//     SerializedBooleanSchema,
//     SerializedNumberSchema,
//     SerializedObjectSchema,
//     SerializedOneOfSchema,
//     SerializedArraySchema,
//     SerializedUnionSchema,
//     SerializedRichTextSchema,
//     SerializedImageSchema,
//     SerializedI18nSchema,
//   ]);
// });
