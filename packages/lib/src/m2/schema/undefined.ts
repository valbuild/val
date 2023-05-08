/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

export type SerializedUndefinedSchema = {
  type: "undefined";
  opt: true;
};

export class UndefinedSchema<Src extends undefined> extends Schema<Src> {
  constructor() {
    super();
  }

  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    return typeof src === "undefined";
  }

  optional(): Schema<undefined> {
    return new UndefinedSchema();
  }

  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}
