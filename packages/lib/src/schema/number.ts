import { OptIn, OptOut, Schema } from "./Schema";

export type SerializedNumberSchema = {
  type: "number";
  opt: boolean;
};

export class NumberSchema<Opt extends boolean> extends Schema<
  OptIn<number, Opt>,
  OptOut<number, Opt>
> {
  constructor(public readonly opt: Opt) {
    super(opt);
  }

  protected validate(src: OptIn<number, Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Required number cannot be null"];
      return false;
    }
    return false;
  }

  hasI18n(): false {
    return false;
  }

  protected transform(src: OptIn<number, Opt>): OptOut<number, Opt> {
    return src;
  }

  protected delocalizePath(
    _src: OptIn<number, Opt>,
    localPath: string[]
  ): string[] {
    if (localPath.length !== 0) {
      throw Error("Invalid path: Cannot access property of number value");
    }
    return localPath;
  }

  serialize(): SerializedNumberSchema {
    return {
      type: "number",
      opt: this.opt,
    };
  }

  optional(): NumberSchema<true> {
    if (this.opt) console.warn("Schema is already optional");
    return new NumberSchema(true);
  }

  static deserialize(schema: SerializedNumberSchema): NumberSchema<boolean> {
    return new NumberSchema(schema.opt);
  }
}
export const number = (): NumberSchema<false> => {
  return new NumberSchema(false);
};
number.optional = (): NumberSchema<true> => {
  return new NumberSchema(true);
};
