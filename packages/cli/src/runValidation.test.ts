import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs";
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
  let tmpDir: string;

  beforeEach(() => {
    const tmpBase = path.join(__dirname, ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpBase, "runValidation-"));
    fs.cpSync(BASIC_FIXTURE, tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns summary-success for a valid module", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-valid.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-success" });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(0);
  });

  test("returns validation-error for a module with minLength violation", async () => {
    const events: ValidationEvent[] = [];

    for await (const event of runValidation({
      root: tmpDir,
      fix: false,
      valFiles: ["content/basic-errors.val.ts"],
      project: undefined,
      remote: mockRemote,
      fs: createDefaultValFSHost(),
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    expect(events.filter((e) => e.type === "validation-error")).toHaveLength(1);
  });
});
