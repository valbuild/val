import { NumberDescriptor } from "../descriptor";
import { maybeOptDesc, MaybeOptDesc, OptIn, OptOut, Schema } from "./Schema";

export type SerializedNumberSchema = {
  type: "number";
  opt: boolean;
};

export class NumberSchema<Opt extends boolean> extends Schema<
  OptIn<number, Opt>,
  OptOut<number, Opt>
> {
  constructor(protected readonly opt: Opt) {
    super(opt);
  }

  validate(src: OptIn<number, Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Non-optional number cannot be null"];
      return false;
    }
    return false;
  }

  hasI18n(): false {
    return false;
  }

  localize(src: OptIn<number, Opt>): OptOut<number, Opt> {
    return src;
  }

  delocalizePath(_src: number | null, localPath: string[]): string[] {
    return localPath;
  }

  localDescriptor(): MaybeOptDesc<NumberDescriptor, Opt> {
    return this.rawDescriptor();
  }

  rawDescriptor(): MaybeOptDesc<NumberDescriptor, Opt> {
    return maybeOptDesc(NumberDescriptor, this.opt);
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
