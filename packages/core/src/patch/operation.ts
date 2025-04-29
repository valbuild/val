import { array } from "../fp";
import type { JSONValue } from "./ops";

type FileOperationBase<PathType> = {
  op: "file";
  metadata?: JSONValue;
  /** path of the top-most element where the schema of the element points to */
  path: PathType;
  /** unless remote: file path relative to project (starts with /public, e.g. /public/example.png), for remote: the whole remote ref */
  filePath: string;
  /** files can be nested within an object (for richtext), in order to find the actual file element this path can be used (we use this to add the patch_id on files) */
  nestedFilePath?: string[];
  value: JSONValue;
  /** true if this is a remote file */
  remote: boolean;
};
type FileOperationJSON = FileOperationBase<string>;
export type FileOperation = FileOperationBase<string[]>;
/**
 * Raw JSON patch operation.
 */
export type OperationJSON =
  | {
      op: "add";
      path: string;
      value: JSONValue;
    }
  | {
      op: "remove";
      path: string;
    }
  | {
      op: "replace";
      path: string;
      value: JSONValue;
    }
  | {
      op: "move";
      from: string;
      path: string;
    }
  | {
      op: "copy";
      from: string;
      path: string;
    }
  | {
      op: "test";
      path: string;
      value: JSONValue;
    }
  | FileOperationJSON;

/**
 * Parsed form of JSON patch operation.
 */
export type Operation =
  | {
      op: "add";
      path: string[];
      value: JSONValue;
    }
  | {
      op: "remove";
      path: array.NonEmptyArray<string>;
    }
  | {
      op: "replace";
      path: string[];
      value: JSONValue;
    }
  | {
      op: "move";
      /**
       * Must be non-root and not a proper prefix of "path".
       */
      // TODO: Replace with common prefix field
      from: array.NonEmptyArray<string>;
      path: string[];
    }
  | {
      op: "copy";
      from: string[];
      path: string[];
    }
  | {
      op: "test";
      path: string[];
      value: JSONValue;
    }
  | FileOperation;
