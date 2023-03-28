import { StringDescriptor } from "../descriptor";
import { MaybeOptDesc, maybeOptDesc, OptIn, OptOut, Schema } from "./Schema";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
};

export type SerializedStringSchema = {
  type: "string";
  options?: {
    maxLength?: number;
    minLength?: number;
  };
  opt: boolean;
};

export class StringSchema<Opt extends boolean> extends Schema<
  OptIn<string, Opt>,
  OptOut<string, Opt>
> {
  constructor(
    private readonly options: StringOptions | undefined,
    protected readonly opt: Opt
  ) {
    super(opt);
  }

  validate(src: OptIn<string, Opt>): false | string[] {
    if (src === null) {
      if (!this.opt) return ["Non-optional string cannot be null"];
      return false;
    }
    const errors: string[] = [];
    if (
      this.options?.maxLength !== undefined &&
      src.length > this.options.maxLength
    ) {
      errors.push(
        `String '${src}' is too long. Length: ${src.length}. Max ${this.options.maxLength}`
      );
    }
    if (
      this.options?.minLength !== undefined &&
      src.length < this.options.minLength
    ) {
      errors.push(
        `String '${src}' is too short. Length: ${src.length}.Min ${this.options.minLength}.`
      );
    }
    if (errors.length > 0) {
      return errors;
    }

    return false;
  }

  hasI18n(): false {
    return false;
  }

  localize(src: OptIn<string, Opt>): OptOut<string, Opt> {
    return src;
  }

  delocalizePath(_src: string | null, path: string[]): string[] {
    return path;
  }

  localDescriptor(): MaybeOptDesc<StringDescriptor, Opt> {
    return this.rawDescriptor();
  }

  rawDescriptor(): MaybeOptDesc<StringDescriptor, Opt> {
    return maybeOptDesc(StringDescriptor, this.opt);
  }

  serialize(): SerializedStringSchema {
    return {
      type: "string",
      options: this.options,
      opt: this.opt,
    };
  }

  optional(): StringSchema<true> {
    if (this.opt) console.warn("Schema is already optional");
    return new StringSchema(this.options, true);
  }

  static deserialize(schema: SerializedStringSchema): StringSchema<boolean> {
    return new StringSchema(schema.options, schema.opt);
  }
}
export const string = (options?: StringOptions): StringSchema<false> => {
  return new StringSchema(options, false);
};
string.optional = (options?: StringOptions): StringSchema<true> => {
  return new StringSchema(options, true);
};
