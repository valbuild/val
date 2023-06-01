/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { SourcePath } from "../val";

export type SerializedLiteralSchema = {
  type: "literal";
  value: string;
  opt: boolean;
};

export class LiteralSchema<Src extends string | null> extends Schema<Src> {
  constructor(readonly value: string, readonly opt: boolean = false) {
    super();
  }

  validate(src: Src): false | Record<SourcePath, string[]> {
    throw new Error("Method not implemented.");
  }

  match(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "string";
  }

  optional(): Schema<Src | null> {
    return new LiteralSchema<Src | null>(this.value, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "literal",
      value: this.value,
      opt: this.opt,
    };
  }
}

export const literal = <T extends string>(value: T): Schema<T> => {
  return new LiteralSchema(value);
};