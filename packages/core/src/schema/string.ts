/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ReifiedRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
  regexp?: RegExp;
  regExpMessage?: string;
};

export type SerializedStringSchema = {
  type: "string";
  options?: {
    maxLength?: number;
    minLength?: number;
    regexp?: {
      message?: string;
      source: string;
      flags: string;
    };
    customValidate?: boolean;
  };
  opt: boolean;
  raw: boolean;
  customValidate?: boolean;
};

const brand = Symbol("string");
export type RawString = string & { readonly [brand]: "raw" };

export class StringSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: StringOptions,
    private readonly opt: boolean = false,
    private readonly isRaw: boolean = false,
    private readonly customValidateFunctions: ((
      src: Src,
    ) => false | string)[] = [],
  ) {
    super();
  }

  /**
   * @deprecated Use `minLength` instead
   */
  min(minLength: number): StringSchema<Src> {
    return this.minLength(minLength);
  }

  minLength(minLength: number): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, minLength },
      this.opt,
      this.isRaw,
    );
  }

  /**
   * @deprecated Use `maxLength` instead
   */
  max(maxLength: number): StringSchema<Src> {
    return this.maxLength(maxLength);
  }

  maxLength(maxLength: number): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, maxLength },
      this.opt,
      this.isRaw,
    );
  }

  regexp(regexp: RegExp, message?: string): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, regexp, regExpMessage: message },
      this.opt,
      this.isRaw,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions.concat(validationFunction),
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const errors: ValidationError[] = this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
    if (this.opt && (src === null || src === undefined)) {
      return errors.length > 0 ? { [path]: errors } : false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (this.options?.maxLength && src.length > this.options.maxLength) {
      errors.push({
        message: `Expected string to be at most ${this.options.maxLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (this.options?.minLength && src.length < this.options.minLength) {
      errors.push({
        message: `Expected string to be at least ${this.options.minLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (this.options?.regexp && !this.options.regexp.test(src)) {
      errors.push({
        message:
          this.options.regExpMessage ||
          `Expected string to match reg exp: ${this.options.regexp.toString()}, got '${src}'`,
        value: src,
      });
    }
    if (errors.length > 0) {
      return {
        [path]: errors,
      } as ValidationErrors;
    }
    return false;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (typeof src === "string") {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `Expected 'string', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): StringSchema<Src | null> {
    return new StringSchema<Src | null>(this.options, true, this.isRaw);
  }

  raw(): StringSchema<Src extends null ? RawString | null : RawString> {
    return new StringSchema<Src extends null ? RawString | null : RawString>(
      this.options,
      this.opt,
      true,
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "string",
      options: {
        maxLength: this.options?.maxLength,
        minLength: this.options?.minLength,
        regexp: this.options?.regexp && {
          message: this.options.regExpMessage,
          source: this.options.regexp.source,
          flags: this.options.regexp.flags,
        },
        customValidate:
          this.customValidateFunctions &&
          this.customValidateFunctions?.length > 0,
      },
      opt: this.opt,
      raw: this.isRaw,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const string = <T extends string>(
  options?: Record<string, never>,
): StringSchema<T> => {
  return new StringSchema(options);
};
