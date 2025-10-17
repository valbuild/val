import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { RenderSelector, ReifiedRender } from "../render";
import { splitModuleFilePathAndModulePath } from "../module";
import { ValRouter } from "../router";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import { RemoteSource } from "../source/remote";
import { ModuleFilePath, SourcePath } from "../val";
import { ImageMetadata } from "./image";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { validateLocale } from "../locale";

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  opt: boolean;
  router?: string;
  locale?: string | null;
  customValidate?: boolean;
};

export class RecordSchema<
  T extends Schema<SelectorSource>,
  Src extends Record<string, SelectorOfSchema<T>> | null,
> extends Schema<Src> {
  constructor(
    private readonly item: T,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly currentRouter: ValRouter | null = null,
    private readonly currentLocale: string | null = null,
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): RecordSchema<T, Src> {
    return new RecordSchema(this.item, this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (src === null) {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got 'null'` },
        ],
      } as ValidationErrors;
    }
    if (typeof src !== "object") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got '${typeof src}'` },
        ],
      } as ValidationErrors;
    }
    if (Array.isArray(src)) {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'object', got 'array'` },
        ],
      } as ValidationErrors;
    }
    const routerValidations = this.getRouterValidations(path, src);
    if (routerValidations) {
      return routerValidations;
    }
    if (this.currentLocale) {
      const localeValidation = validateLocale(this.currentLocale);
      if (localeValidation) {
        const message = localeValidation;
        error = this.appendValidationError(error, path, message, src, true);
      }
    }
    for (const customValidationError of customValidationErrors) {
      error = this.appendValidationError(
        error,
        path,
        customValidationError.message,
        src,
        customValidationError.schemaError,
      );
    }
    Object.entries(src).forEach(([key, elem]) => {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${elem}`, // Should! never happen
          src,
        );
      } else {
        const subError = this.item["executeValidate"](
          subPath,
          elem as SelectorSource,
        );
        if (subError && error) {
          error = {
            ...subError,
            ...error,
          };
        } else if (subError) {
          error = subError;
        }
      }
    });
    return error;
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
    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'object', got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'array'`, typeError: true },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): RecordSchema<T, Src | null> {
    return new RecordSchema(this.item, true);
  }

  router(router: ValRouter): RecordSchema<T, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      router.withSchema(this),
    );
  }

  private getRouterValidations(path: SourcePath, src: Src): ValidationErrors {
    if (!this.currentRouter) {
      return false;
    }
    if (src === null) {
      return false;
    }
    const [moduleFilePath, modulePath] = splitModuleFilePathAndModulePath(path);
    if (modulePath) {
      return {
        [path]: [
          {
            message: `This field was configured as a router, but it is not defined at the root of the module`,
            schemaError: true,
          },
        ],
      };
    }
    const routerValidations = this.currentRouter.validate(
      moduleFilePath,
      Object.keys(src),
    );
    if (routerValidations.length > 0) {
      return Object.fromEntries(
        routerValidations.map((validation): [SourcePath, ValidationError[]] => {
          if (!validation.error.urlPath) {
            return [
              path,
              [
                {
                  message: `Router validation error: ${validation.error.message} has no url path`,
                  schemaError: true,
                },
              ],
            ];
          }
          const subPath = createValPathOfItem(path, validation.error.urlPath);
          if (!subPath) {
            return [
              path,
              [
                {
                  message: `Could not create path for router validation error`,
                  schemaError: true,
                },
              ],
            ];
          }
          return [
            subPath,
            [
              {
                message: validation.error.message,
              },
            ],
          ];
        }),
      );
    }
    return false;
  }

  protected executeSerialize(): SerializedRecordSchema {
    return {
      type: "record",
      item: this.item["executeSerialize"](),
      opt: this.opt,
      router: this.currentRouter?.getRouterId(),
      locale: this.currentLocale,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  private renderInput: {
    layout: "list";
    select: (input: { key: string; val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  } | null = null;

  protected override executeRender(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
  ): ReifiedRender {
    const res: ReifiedRender = {};
    if (src === null) {
      return res;
    }
    for (const key in src) {
      const itemSrc = src[key];
      if (itemSrc === null || itemSrc === undefined) {
        continue;
      }
      const subPath = unsafeCreateSourcePath(sourcePath, key);
      const itemResult = this.item["executeRender"](subPath, itemSrc);
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    if (this.renderInput) {
      const { select: prepare, layout: layout } = this.renderInput;
      if (layout !== "list") {
        res[sourcePath] = {
          status: "error",
          message: "Unknown layout type: " + layout,
        };
      }
      try {
        res[sourcePath] = {
          status: "success",
          data: {
            layout: "list",
            parent: "record",
            items: Object.entries(src).map(([key, val]) => {
              // NB NB: display is actually defined by the user
              const { title, subtitle, image } = prepare({ key, val });
              return [key, { title, subtitle, image }];
            }),
          },
        };
      } catch (e) {
        res[sourcePath] = {
          status: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        };
      }
    }
    return res;
  }

  render(input: {
    layout: "list";
    select: (input: { key: string; val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  }) {
    this.renderInput = input;
    return this;
  }
}

export const record = <S extends Schema<SelectorSource>>(
  schema: S,
): RecordSchema<S, Record<string, SelectorOfSchema<S>>> => {
  return new RecordSchema(schema);
};
