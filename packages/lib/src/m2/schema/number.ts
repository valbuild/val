/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";

type NumberOptions = {
  max?: number;
  min?: number;
};

export type SerializedNumberSchema = {
  type: "number";
  options?: NumberOptions;
  opt: boolean;
};

export class NumberSchema<Src extends number> extends Schema<Src> {
  protected validate(src: number): false | string[] {
    throw new Error("Method not implemented.");
  }
  protected serialize(): SerializedSchema {
    throw new Error("Method not implemented.");
  }
}

export const number = (options?: NumberOptions): Schema<number> => {
  return new NumberSchema();
};
