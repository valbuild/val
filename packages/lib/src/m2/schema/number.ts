/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

type NumberOptions = {
  max?: number;
  min?: number;
};

export type SerializedNumberSchema = {
  type: "number";
  options?: NumberOptions;
  opt: boolean;
};

export class NumberSchema<Src extends number | null> extends Schema<Src> {
  constructor(
    readonly options?: NumberOptions,
    readonly isOptional: boolean = false
  ) {
    super();
  }
  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.isOptional && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "number";
  }

  optional(): Schema<Src | null> {
    return new NumberSchema<Src | null>(this.options, true);
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const number = (options?: NumberOptions): Schema<number> => {
  return new NumberSchema(options);
};
