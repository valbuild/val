import type {
  JSONValue as JSONValueT,
  OperationJSON as OperationJSONT,
  PatchJSON as PatchJSONT,
  Operation as OperationT,
  Patch as PatchT,
} from "@valbuild/core/patch";
import z from "zod";

const JSONValueT: z.ZodType<JSONValueT> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JSONValueT),
    z.record(JSONValueT),
  ]),
);

/**
 * Raw JSON patch operation.
 */
const OperationJSONT: z.ZodType<OperationJSONT> = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      path: z.string(),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("remove"),
      /**
       * Must be non-root
       */
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace"),
      path: z.string(),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      /**
       * Must be non-root and not a proper prefix of "path".
       */
      from: z.string(),
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("copy"),
      from: z.string(),
      path: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("test"),
      path: z.string(),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("file"),
      path: z.string(),
      filePath: z.string(),
      value: z.string(),
    })
    .strict(),
]);

export const PatchJSON: z.ZodType<PatchJSONT> = z.array(OperationJSONT);
export type PatchJSON = PatchJSONT;

/**
 * Raw JSON patch operation.
 */
const OperationT: z.ZodType<OperationT> = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      path: z.array(z.string()),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("remove"),
      path: z.array(z.string()).nonempty(),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace"),
      path: z.array(z.string()),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("move"),
      from: z.array(z.string()).nonempty(),
      path: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      op: z.literal("copy"),
      from: z.array(z.string()),
      path: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      op: z.literal("test"),
      path: z.array(z.string()),
      value: JSONValueT,
    })
    .strict(),
  z
    .object({
      op: z.literal("file"),
      path: z.array(z.string()),
      filePath: z.string(),
      nestedFilePath: z.array(z.string()).optional(),
      value: z.union([
        z.string(),
        z.object({
          sha256: z.string(),
        }),
      ]),
    })
    .strict(),
]);

export const Patch: z.ZodType<PatchT> = z.array(OperationT);
export type Patch = PatchT;
