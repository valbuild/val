import { array } from "../fp";
import type { JSONValue } from "./ops";

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
    };

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
    };
