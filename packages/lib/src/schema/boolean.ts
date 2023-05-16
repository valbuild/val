/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

export type SerializedBooleanSchema = {
  type: "boolean";
  opt: boolean;
};

export class BooleanSchema<Src extends boolean | null> extends Schema<Src> {
  constructor(readonly isOptional: boolean = false) {
    super();
  }
  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.isOptional && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "boolean";
  }

  optional(): Schema<Src | null> {
    return new BooleanSchema<Src | null>(true);
  }
  serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const boolean = (): Schema<boolean> => {
  return new BooleanSchema();
};
