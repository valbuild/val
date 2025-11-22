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

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  key?: SerializedSchema;
  opt: boolean;
  router?: string;
  customValidate?: boolean;
};

export class RecordSchema<
  T extends Schema<SelectorSource>,
  K extends Schema<string>,
  Src extends Record<SelectorOfSchema<K>, SelectorOfSchema<T>> | null,
> extends Schema<Src> {
  constructor(
    private readonly item: T,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly currentRouter: ValRouter | null = null,
    private readonly keySchema: K | null = null,
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.currentRouter,
      this.keySchema,
    );
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
      if (this.keySchema) {
        const keyPath = createValPathOfItem(path, key);
        if (!keyPath) {
          throw new Error(
            `Internal error: could not create path at ${
              !path && typeof path === "string" ? "<empty string>" : path
            } for key validation`, // Should! never happen
          );
        }
        const keyError = this.keySchema["executeValidate"](keyPath, key);
        if (keyError) {
          keyError[keyPath] = keyError[keyPath].map((err) => ({
            ...err,
            keyError: true,
          }));
          if (error) {
            if (error[keyPath]) {
              error[keyPath] = [...error[keyPath], ...keyError[keyPath]];
            } else {
              error[keyPath] = keyError[keyPath];
            }
          } else {
            error = keyError;
          }
        }
      }

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

  nullable(): RecordSchema<T, K, Src | null> {
    return new RecordSchema(
      this.item,
      true,
      this.customValidateFunctions,
      this.currentRouter,
      this.keySchema,
    ) as RecordSchema<T, K, Src | null>;
  }

  router(router: ValRouter): RecordSchema<T, K, Src> {
    return new RecordSchema(
      this.item,
      this.opt,
      this.customValidateFunctions,
      router,
      this.keySchema,
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
    const routerValidationErrors = this.currentRouter.validate(
      moduleFilePath,
      Object.keys(src),
    );
    if (routerValidationErrors.length > 0) {
      return Object.fromEntries(
        routerValidationErrors.map(
          (validation): [SourcePath, ValidationError[]] => {
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
              throw new Error(
                `Internal error: could not create path at ${
                  !path && typeof path === "string" ? "<empty string>" : path
                } for router validation`, // Should! never happen
              );
            }
            return [
              subPath,
              [
                {
                  message: validation.error.message,
                  value: validation.error.urlPath,
                  keyError: true,
                },
              ],
            ];
          },
        ),
      );
    }
    return false;
  }

  protected executeSerialize(): SerializedRecordSchema {
    return {
      type: "record",
      item: this.item["executeSerialize"](),
      key: this.keySchema?.["executeSerialize"](),
      opt: this.opt,
      router: this.currentRouter?.getRouterId(),
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
      const itemSrc = src[key as unknown as SelectorOfSchema<K>];
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
              const { title, subtitle, image } = prepare({
                key: key as unknown as KeyType,
                val: val as SelectorOfSchema<T>,
              });
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
    as: "list";
    select: (input: { key: string; val: RenderSelector<T> }) => {
      title: string;
      subtitle?: string | null;
      image?: ImageSource | RemoteSource<ImageMetadata> | null;
    };
  }) {
    this.renderInput = {
      layout: input.as,
      select: input.select,
    };
    return this;
  }
}

// Overload: with key schema
export function record<
  K extends Schema<string>,
  S extends Schema<SelectorSource>,
>(
  key: K,
  schema: S,
): RecordSchema<S, K, Record<SelectorOfSchema<K>, SelectorOfSchema<S>>>;

// Overload: without key schema
export function record<S extends Schema<SelectorSource>>(
  schema: S,
): RecordSchema<S, Schema<string>, Record<string, SelectorOfSchema<S>>>;

// Implementation
export function record<
  K extends Schema<string>,
  S extends Schema<SelectorSource>,
>(
  keyOrSchema: K | S,
  schema?: S,
): RecordSchema<S, K, Record<SelectorOfSchema<K>, SelectorOfSchema<S>>> {
  if (schema) {
    // Two-argument call: first is key schema, second is value schema
    return new RecordSchema(schema, false, [], null, keyOrSchema as K);
  } else {
    // One-argument call: only value schema
    return new RecordSchema(
      keyOrSchema as S,
      false,
      [],
      null,
      keyOrSchema as K,
    );
  }
}
