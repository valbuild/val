/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
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
};

export class DateSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    readonly options?: DateOptions,
    readonly opt: boolean = false,
    private readonly isRaw: boolean = true
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
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
              fatal: true,
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

  assert(src: Src): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    return typeof src === "string";
  }

  from(from: string): DateSchema<Src> {
    return new DateSchema<Src>({ ...this.options, from }, this.opt, this.isRaw);
  }

  to(to: string): DateSchema<Src> {
    return new DateSchema<Src>({ ...this.options, to }, this.opt, this.isRaw);
  }

  nullable(): DateSchema<Src | null> {
    return new DateSchema<Src | null>(this.options, true, this.isRaw);
  }

  serialize(): SerializedSchema {
    return {
      type: "date",
      opt: this.opt,
      options: this.options,
    };
  }
}

export const date = <T extends RawString>(
  options?: Record<string, never>
): DateSchema<T> => {
  return new DateSchema(options);
};
