import type {
  JSONValue as JSONValueT,
  OperationJSON as OperationJSONT,
  PatchJSON as PatchJSONT,
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
  ])
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
      value: z.string(),
    })
    .strict(),
]);

export const PatchJSON: z.ZodType<PatchJSONT> = z.array(OperationJSONT);
export type PatchJSON = PatchJSONT;
