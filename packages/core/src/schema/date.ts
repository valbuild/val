/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import { SourcePath } from "../val";
import { RawString } from "./string";
import { ValidationErrors } from "./validation/ValidationError";

type DateOptions = {
  /**
   * Validate that the date is this date or after (inclusive).
   *
   * @example
   * 2021-01-01
   */
  from?: string;
  /**
   * Validate that the date is this date or before (inclusive).
   *
   * @example
   * 2021-01-01
   */
  to?: string;
};

export type SerializedDateSchema = {
  type: "date";
  options?: DateOptions;
  opt: boolean;
  customValidate?: boolean;
};

export class DateSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: DateOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
  }

  validate(validationFunction: (src: Src) => false | string): DateSchema<Src> {
    return new DateSchema(this.options, this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (this.options?.from && this.options?.to) {
      if (this.options.from > this.options.to) {
        return {
          [path]: [
            {
              message: `From date ${this.options.from} is after to date ${this.options.to}`,
              value: src,
              typeError: true,
            },
          ],
        } as ValidationErrors;
      }
      if (src < this.options.from || src > this.options.to) {
        return {
          [path]: [
            {
              message: `Date is not between ${this.options.from} and ${this.options.to}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    } else if (this.options?.from) {
      if (src < this.options.from) {
        return {
          [path]: [
            {
              message: `Date is before the minimum date ${this.options.from}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    } else if (this.options?.to) {
      if (src > this.options.to) {
        return {
          [path]: [
            {
              message: `Date is after the maximum date ${this.options.to}`,
              value: src,
            },
          ],
        } as ValidationErrors;
      }
    }
    // const errors = [];

    // if (errors.length > 0) {
    //   return {
    //     [path]: errors,
    //   } as ValidationErrors;
    // }
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
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected 'string', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src !== "string") {
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

    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  from(from: string): DateSchema<Src> {
    return new DateSchema<Src>({ ...this.options, from }, this.opt);
  }

  to(to: string): DateSchema<Src> {
    return new DateSchema<Src>({ ...this.options, to }, this.opt);
  }

  nullable(): DateSchema<Src | null> {
    return new DateSchema<Src | null>(this.options, true);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "date",
      opt: this.opt,
      options: this.options,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const date = (
  options?: Record<string, never>,
): DateSchema<RawString> => {
  return new DateSchema(options);
};
