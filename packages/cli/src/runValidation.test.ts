import { describe, test, expect } from "@jest/globals";
import path from "path";
import { DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import {
  createDefaultValFSHost,
  runValidation,
  ValidationEvent,
  IValRemote,
} from "./runValidation";

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");

const mockRemote: IValRemote = {
  remoteHost: DEFAULT_VAL_REMOTE_HOST,
  getSettings: async () => {
    throw new Error("Not expected to be called");
  },
  uploadFile: async () => {
    throw new Error("Not expected to be called");
  },
};

describe("runValidation", () => {
  test("returns summary-success for a valid module", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: BASIC_FIXTURE,
      fix: false,
      valFiles: ["content/test.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-success" });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(0);
  });
});
