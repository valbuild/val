import type {
  JSONValue as JSONValueT,
  OperationJSON as OperationJSONT,
  PatchJSON as PatchJSONT,
  Operation as OperationT,
  Patch as PatchT,
  PatchBlock as PatchBlockT,
  ParentRef as ParentRefT,
} from "@valbuild/core/patch";
import type { PatchId as PatchIdT } from "@valbuild/core";
import { z } from "zod";

const JSONValue: z.ZodType<JSONValueT> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JSONValue),
    z.record(JSONValue),
  ]),
);

const FileOperation = <PathType extends z.ZodType>(path: PathType) =>
  z.object({
    op: z.literal("file"),
    path,
    filePath: z.string(),
    value: z.string(),
    remote: z.boolean(),
    nestedFilePath: z.array(z.string()).optional(),
    metadata: JSONValue.optional(), // TODO: remove optional
  });

/**
 * Raw JSON patch operation.
 */
const OperationJSON: z.ZodType<OperationJSONT> = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      path: z.string(),
      value: JSONValue,
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
      value: JSONValue,
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
      value: JSONValue,
    })
    .strict(),
  FileOperation(z.string()).strict(),
]);

export const PatchJSON: z.ZodType<PatchJSONT> = z.array(OperationJSON);
export type PatchJSON = PatchJSONT;

/**
 * Raw JSON patch operation.
 */
const Operation: z.ZodType<OperationT> = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("add"),
      path: z.array(z.string()),
      value: JSONValue,
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
      value: JSONValue,
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
      value: JSONValue,
    })
    .strict(),
  FileOperation(z.array(z.string())).strict(),
]);

export const Patch: z.ZodType<PatchT> = z.array(Operation);
export type Patch = PatchT;

export const PatchId = z.string().refine(
  (_id): _id is PatchIdT => true, // TODO: validation
);

type ParentRefInput =
  | {
      type: "head";
      headBaseSha: string;
    }
  | {
      type: "patch";
      patchId: string;
    };
export const ParentRef: z.ZodType<ParentRefT, z.ZodTypeDef, ParentRefInput> =
  z.union([
    z.object({ type: z.literal("head"), headBaseSha: z.string() }),
    z.object({
      type: z.literal("patch"),
      patchId: PatchId,
    }),
  ]);
export type ParentRef = ParentRefT;

export const PatchBlock: z.ZodType<
  PatchBlockT,
  z.ZodTypeDef,
  {
    patch: Patch;
    parentRef: ParentRefInput;
  }
> = z.object({
  patch: Patch,
  parentRef: ParentRef,
});

export type PatchBlock = PatchBlockT;
