/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ModuleFilePath, SourcePath } from "../val";
import { ReifiedRender } from "../render";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type RouteOptions = {
  include?: RegExp;
  exclude?: RegExp;
};

export type SerializedRouteSchema = {
  type: "route";
  options?: {
    include?: {
      source: string;
      flags: string;
    };
    exclude?: {
      source: string;
      flags: string;
    };
    customValidate?: boolean;
  };
  opt: boolean;
  customValidate?: boolean;
};

export class RouteSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: RouteOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: ((
      src: Src,
    ) => false | string)[] = [],
  ) {
    super();
  }

  /**
   * Specify a pattern for which routes are allowed.
   *
   * Semantics:
   * - If only include is set: route must match include pattern
   * - If only exclude is set: route must NOT match exclude pattern
   * - If both are set: route must match include AND must NOT match exclude
   *
   * @example
   * s.route().include(/^\/(home|about|contact)$/)  // Only these specific routes
   * s.route().include(/^\/api\//).exclude(/^\/api\/internal\//)  // API routes except internal
   */
  include(pattern: RegExp): RouteSchema<Src> {
    return new RouteSchema<Src>(
      { ...this.options, include: pattern },
      this.opt,
      this.customValidateFunctions,
    );
  }

  /**
   * Specify a pattern for which routes should be excluded.
   *
   * Semantics:
   * - If only include is set: route must match include pattern
   * - If only exclude is set: route must NOT match exclude pattern
   * - If both are set: route must match include AND must NOT match exclude
   *
   * @example
   * s.route().exclude(/^\/admin/)  // Exclude all admin routes
   * s.route().include(/^\/api\//).exclude(/^\/api\/internal\//)  // API routes except internal
   */
  exclude(pattern: RegExp): RouteSchema<Src> {
    return new RouteSchema<Src>(
      { ...this.options, exclude: pattern },
      this.opt,
      this.customValidateFunctions,
    );
  }

  validate(validationFunction: (src: Src) => false | string): RouteSchema<Src> {
    return new RouteSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions.concat(validationFunction),
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }

    return {
      [path]: [
        ...customValidationErrors,
        {
          fixes: ["router:check-route"],
          message: `Did not validate route (router). This error (router:check-route) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
          value: {
            route: src,
            sourcePath: path,
            include: this.options?.include,
            exclude: this.options?.exclude,
          },
        },
      ],
    };
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

  nullable(): RouteSchema<Src | null> {
    return new RouteSchema(
      this.options,
      true,
      this.customValidateFunctions,
    ) as unknown as RouteSchema<Src | null>;
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "route",
      options: {
        include: this.options?.include && {
          source: this.options.include.source,
          flags: this.options.include.flags,
        },
        exclude: this.options?.exclude && {
          source: this.options.exclude.source,
          flags: this.options.exclude.flags,
        },
        customValidate:
          this.customValidateFunctions &&
          this.customValidateFunctions?.length > 0,
      },
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const route = <T extends string>(
  options?: Record<string, never>,
): RouteSchema<T> => {
  return new RouteSchema(options);
};
