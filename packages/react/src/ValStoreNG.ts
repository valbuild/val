import {
  ModuleId,
  ModulePath,
  SerializedModule,
  SerializedSchema,
  SerializedVal,
} from "@valbuild/core";
import {
  BranchRef,
  CommitSha,
  OrgName,
  ProjectName,
  PatchId,
} from "@valbuild/core/internal";
import { JSONValue } from "@valbuild/core/patch";
import { SerializedArraySchema } from "@valbuild/core/src/schema/array";
import { SerializedObjectSchema } from "@valbuild/core/src/schema/object";

export type PatchError = {
  patch_id: PatchId;
  error: {
    message: string;
  };
};

type Request<T> =
  | {
      status: "requested";
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "ready";
      data: T;
    };
type PatchData = {
  val_id: ModuleId;
  author: string;
  updated_at: Date;
  ops: {
    [path: ModulePath]: {
      op: "add" | "remove" | "replace";
      value: JSONValue;
      preOpVal: JSONValue;
    };
  };
  // TODO: postPatchValHash: string; // used to check if the application of the patch was valid
};

type DraftOp =
  | {
      op: "replace";
      value: JSONValue;
    }
  | { op: "add"; value: JSONValue }
  | { op: "remove" }
  | { op: "move"; from: string };

type ValSchemaAtPath =
  | {
      compositeType: "object";
      schema: SerializedObjectSchema;
      paths: ModulePath[];
    }
  | {
      compositeType: "array";
      schema: SerializedArraySchema;
      paths: ModulePath[];
    }
  | {
      compositeType: false;
      schema: SerializedSchema;
      source: SerializedVal;
    };

export type ValState = {
  org: OrgName;
  project: ProjectName;
  moduleIds: ModuleId[];
  // Lazily loaded when requested:
  appliedPatches: Map<ModuleId, Request<PatchId[]>>;
  failedPatches: Map<ModuleId, Request<PatchError[]>>;
  patches: Map<PatchId, Request<PatchData[]>>;
  draftPatches: Map<ModuleId, Map<ModulePath, DraftOp>>; // drafts patches are patches that have not been submitted yet
  modules: Map<
    ModuleId,
    // Current fetch granularity is at the module level, however, we want to emit changes at a path level
    Request<SerializedModule>
  >;
} & (
  | { proxy: true; branch: BranchRef; head: CommitSha }
  | { proxy: false; branch: undefined; head: undefined }
);
