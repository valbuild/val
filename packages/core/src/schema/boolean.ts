/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

export type SerializedBooleanSchema = {
  type: "boolean";
  opt: boolean;
};

export class BooleanSchema<Src extends boolean | null> extends Schema<Src> {
  constructor(readonly opt: boolean = false) {
    super();
  }
  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "boolean";
  }

  optional(): Schema<Src | null> {
    return new BooleanSchema<Src | null>(true);
  }
  serialize(): SerializedSchema {
    return {
      type: "boolean",
      opt: this.opt,
    };
  }
}

export const boolean = (): Schema<boolean> => {
  return new BooleanSchema();
};