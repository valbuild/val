import {
  AssertError,
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { unsafeCreateSourcePath } from "../selector/SelectorProxy";
import { ImageSource } from "../source/media";
import {
  RichTextSource,
  RichTextOptions,
  SerializedRichTextOptions,
} from "../source/richtext";
import { SourcePath } from "../val";
import { ImageSchema, SerializedImageSchema } from "./image";
import { RouteSchema, SerializedRouteSchema } from "./route";
import { SerializedStringSchema, StringSchema } from "./string";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type ValidationOptions = {
  maxLength?: number;
  minLength?: number;
};
export type SerializedRichTextSchema = {
  type: "richtext";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  opt: boolean;
  options?: SerializedRichTextOptions & ValidationOptions;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class RichTextSchema<
  O extends RichTextOptions,
  Src extends RichTextSource<O> | null,
> extends Schema<Src> {
  constructor(
    private readonly options: O & ValidationOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  describe(description: string | null): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  maxLength(max: number): RichTextSchema<O, Src> {
    return new RichTextSchema(
      {
        ...this.options,
        maxLength: max,
      },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  minLength(min: number): RichTextSchema<O, Src> {
    return new RichTextSchema(
      {
        ...this.options,
        minLength: min,
      },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    const assertRes = this.executeAssert(path, src);
    if (!assertRes.success) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : assertRes.errors;
    }
    const nodes = assertRes.data;
    if (nodes === null && this.opt) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (nodes === null) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: "Expected 'array', got 'null'",
            typeError: true,
          },
        ],
      };
    }

    const current = {};
    const typeErrorRes = this.internalValidate(path, nodes, current);
    if (typeErrorRes) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors, ...typeErrorRes }
        : typeErrorRes;
    }
    if (Object.keys(current).length > 0) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors, ...current }
        : current;
    }
    if (customValidationErrors.length > 0) {
      return {
        [path]: customValidationErrors,
      };
    }
    return false;
  }

  private internalValidate(
    rootPath: SourcePath,
    nodes: unknown[],
    current: Record<SourcePath, ValidationError[]>,
  ): ValidationErrors {
    let length = 0;
    const recurse = (
      rootPath: SourcePath,
      nodes: unknown[],
      current: Record<SourcePath, ValidationError[]>,
    ): ValidationErrors => {
      const addError = (
        path: SourcePath,
        message: string,
        typeError: boolean,
      ) => {
        if (!current[path]) {
          current[path] = [];
        }
        current[path].push({
          message,
          typeError,
        });
      };
      for (const node of nodes) {
        const path = unsafeCreateSourcePath(rootPath, nodes.indexOf(node));
        if (typeof node === "string") {
          length += node.length;
          continue;
        }
        if (typeof node !== "object") {
          return {
            [path]: [
              {
                message: `Expected nodes of type 'object' or 'string', got '${typeof node}'`,
                typeError: true,
              },
            ],
          };
        }
        if (node === null) {
          return {
            [path]: [
              {
                message: `Expected nodes of type 'object' or 'string', got 'null'`,
                typeError: true,
              },
            ],
          };
        }
        if (!("tag" in node)) {
          return {
            [path]: [
              {
                message: `Expected node to either have 'tag' or be of type 'string'`,
                typeError: true,
              },
            ],
          };
        }
        if (typeof node.tag !== "string") {
          return {
            [path]: [
              {
                message: `Expected 'string', got '${typeof node.tag}'`,
                typeError: true,
              },
            ],
          };
        }
        const supportedTags = [
          "p",
          "span",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ol",
          "ul",
          "li",
          "a",
          "img",
          "br",
        ];
        if (!supportedTags.includes(node.tag)) {
          addError(
            path,
            `Tag '${node.tag}' is not supported. Supported tags: ${supportedTags.join(", ")}`,
            true,
          );
        }
        if (node.tag === "h1" && !this.options.h1) {
          addError(path, `'h' block is not valid`, false);
        }
        if (node.tag === "h2" && !this.options.h2) {
          addError(path, `'h2' block is not valid`, false);
        }
        if (node.tag === "h3" && !this.options.h3) {
          addError(path, `'h3' block is not valid`, false);
        }
        if (node.tag === "h4" && !this.options.h4) {
          addError(path, `'h4' block is not valid`, false);
        }
        if (node.tag === "h5" && !this.options.h5) {
          addError(path, `'h5' block is not valid`, false);
        }
        if (node.tag === "h6" && !this.options.h6) {
          addError(path, `'h6' block is not valid`, false);
        }
        if (node.tag === "ol" && !this.options.ol) {
          addError(path, `'ol' block is not valid`, false);
        }
        if (node.tag === "ul" && !this.options.ul) {
          addError(path, `'ul' block is not valid`, false);
        }
        if (node.tag === "li" && !this.options.ul && !this.options.ol) {
          addError(
            path,
            `'li' tag is invalid since neither 'ul' nor 'ol' block is not valid`,
            false,
          );
        }
        if (node.tag === "a") {
          if (!this.options.a) {
            addError(path, `'a' inline is not valid`, false);
          } else if (this.options.a) {
            if (!("href" in node)) {
              return {
                [path]: [
                  {
                    message: `Expected 'href' in 'a'`,
                    typeError: true,
                  },
                ],
              };
            }
            const hrefPath = unsafeCreateSourcePath(path, "href");
            const hrefSchema =
              typeof this.options.a === "boolean"
                ? new RouteSchema()
                : this.options.a;

            const executeValidate = () => {
              if (hrefSchema instanceof RouteSchema) {
                return hrefSchema["executeValidate"](
                  hrefPath,
                  node.href as string,
                );
              } else if (hrefSchema instanceof StringSchema) {
                return hrefSchema["executeValidate"](
                  hrefPath,
                  node.href as string,
                );
              } else {
                const exhaustiveCheck: never = hrefSchema;
                console.error(
                  "Exhaustive check failed in RichText (anchor href validation)",
                  exhaustiveCheck,
                );
                return false;
              }
            };
            const hrefValidationErrors = executeValidate();
            if (hrefValidationErrors) {
              for (const validationErrorPathS in hrefValidationErrors) {
                const validationErrorPath = validationErrorPathS as SourcePath;
                if (!current[validationErrorPath]) {
                  current[validationErrorPath] = [];
                }
                current[validationErrorPath].push(
                  ...hrefValidationErrors[validationErrorPath],
                );
              }
            }
          }
        }

        if (node.tag === "img") {
          if (!this.options.img) {
            addError(path, `'img' inline is not valid`, false);
          } else if (this.options.img) {
            if (!("src" in node)) {
              return {
                [path]: [
                  {
                    message: `Expected 'src' in 'img'`,
                    typeError: true,
                  },
                ],
              };
            }
            const srcPath = unsafeCreateSourcePath(path, "src");
            const imgSchema = this.options.img;
            const imageValidationErrors =
              typeof imgSchema === "object"
                ? (imgSchema as ImageSchema<ImageSource>)["executeValidate"](
                    srcPath,
                    node.src as ImageSource,
                  )
                : new ImageSchema({}, false, false)["executeValidate"](
                    srcPath,
                    node.src as ImageSource,
                  );
            if (imageValidationErrors) {
              for (const validationErrorPathS in imageValidationErrors) {
                const validationErrorPath = validationErrorPathS as SourcePath;
                if (!current[validationErrorPath]) {
                  current[validationErrorPath] = [];
                }
                current[validationErrorPath].push(
                  ...imageValidationErrors[validationErrorPath],
                );
              }
            }
          }
        }
        if ("styles" in node && node.tag !== "span") {
          return {
            [path]: [
              {
                message: `Cannot have styles on '${node.tag}'. This is only allowed on 'span'`,
                typeError: true,
              },
            ],
          };
        }
        if ("styles" in node) {
          if (!Array.isArray(node.styles)) {
            return {
              [path]: [
                {
                  message: `Expected 'array', got '${typeof node.styles}'`,
                  typeError: true,
                },
              ],
            };
          }

          const stylesPath = unsafeCreateSourcePath(path, "styles");
          for (let i = 0; i < node.styles.length; i++) {
            const style = node.styles[i];
            const currentStylePath = unsafeCreateSourcePath(stylesPath, i);
            if (typeof style !== "string") {
              return {
                [currentStylePath]: [
                  {
                    message: `Expected 'string', got '${typeof style}'`,
                    typeError: true,
                  },
                ],
              };
            }
            if (style === "bold" && !this.options.bold) {
              addError(currentStylePath, `Style 'bold' is not valid`, false);
            }
            if (style === "italic" && !this.options.italic) {
              addError(currentStylePath, `Style 'italic' is not valid`, false);
            }
            if (style === "lineThrough" && !this.options.lineThrough) {
              addError(
                currentStylePath,
                `Style 'lineThrough' is not valid`,
                false,
              );
            }
          }
        }
        if ("children" in node) {
          if (!Array.isArray(node.children)) {
            return {
              [path]: [
                {
                  message: `Expected 'array', got '${typeof node.children}'`,
                  typeError: true,
                },
              ],
            };
          }
          const childPath = unsafeCreateSourcePath(path, "children");
          const res = recurse(childPath, node.children, current);
          if (res) {
            return res;
          }
        }
      }
      return false;
    };

    const results = recurse(rootPath, nodes, current);
    const lengthErrors = [];
    if (this.options.maxLength && length > this.options.maxLength) {
      lengthErrors.push({
        message: `Maximum length of ${this.options.maxLength} exceeded (current length: ${length})`,
        typeError: false,
      });
    }
    if (this.options.minLength && length < this.options.minLength) {
      lengthErrors.push({
        message: `Minimum length of ${this.options.minLength} not met (current length: ${length})`,
        typeError: false,
      });
    }
    if (results) {
      if (lengthErrors.length > 0) {
        if (!results[rootPath]) {
          results[rootPath] = [];
        }
        results[rootPath].push(...lengthErrors);
      }
      return results;
    }
    if (Object.keys(current).length > 0) {
      if (lengthErrors.length > 0) {
        if (!current[rootPath]) {
          current[rootPath] = [];
        }
        current[rootPath].push(...lengthErrors);
      }
      return current;
    }
    if (lengthErrors.length > 0) {
      return {
        [rootPath]: lengthErrors,
      };
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
    if (src === null && !this.opt) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'array', got 'null'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'array', got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    const errors: Record<string, AssertError[]> = {};
    for (let i = 0; i < src.length; i++) {
      this.recursiveAssert(unsafeCreateSourcePath(path, i), src[i], errors);
    }
    if (Object.keys(errors).length > 0) {
      return {
        success: false,
        errors,
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  private recursiveAssert(
    path: string,
    node: unknown,
    errors: Record<string, AssertError[]>,
  ) {
    if (typeof node !== "object") {
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push({
        message: `Expected 'object', got '${typeof node}'`,
        typeError: true,
      });
      return;
    }
    if (Array.isArray(node)) {
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push({
        message: `Expected 'object', got 'array'`,
        typeError: true,
      });
      return;
    }
    if (node === null) {
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push({
        message: `Expected 'object', got 'null'`,
        typeError: true,
      });
      return;
    }
    if ("tag" in node) {
      if (typeof node.tag !== "string") {
        if (!errors[path]) {
          errors[path] = [];
        }
        errors[path].push({
          message: `Expected 'string', got '${typeof node.tag}'`,
          typeError: true,
        });
        return;
      }
    }
    if ("children" in node) {
      if (!Array.isArray(node.children)) {
        if (!errors[path]) {
          errors[path] = [];
        }
        errors[path].push({
          message: `Expected 'array', got '${typeof node.children}'`,
          typeError: true,
        });
        return;
      } else {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          const pathAtError = unsafeCreateSourcePath(
            unsafeCreateSourcePath(path, "children"),
            i,
          );
          if (typeof child === "object") {
            this.recursiveAssert(pathAtError, child, errors);
          } else if (typeof child === "string") {
            continue;
          } else {
            if (!errors[pathAtError]) {
              errors[pathAtError] = [];
            }
            errors[pathAtError].push({
              message: `Expected 'object' or 'string', got '${typeof child}'`,
              typeError: true,
            });
          }
        }
      }
    }
    if ("styles" in node) {
      if (!Array.isArray(node.styles)) {
        if (!errors[path]) {
          errors[path] = [];
        }
        errors[path].push({
          message: `Expected 'array', got '${typeof node.styles}'`,
          typeError: true,
        });
      } else {
        for (let i = 0; i < node.styles.length; i++) {
          const style = node.styles[i];
          if (typeof style !== "string") {
            const pathAtError = unsafeCreateSourcePath(path, i);
            if (!errors[pathAtError]) {
              errors[pathAtError] = [];
            }
            errors[pathAtError].push({
              message: `Expected 'string', got '${typeof style}'`,
              typeError: true,
            });
          }
        }
      }
    }
  }

  nullable(): RichTextSchema<O, Src | null> {
    return new RichTextSchema<O, Src | null>(
      this.options,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    return this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
  }

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): RichTextSchema<O, Src> {
    return new RichTextSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      select,
    );
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput === null) {
      return null;
    }
    return this.previewInput({ val: src });
  }

  protected override declaresItemPreview(): boolean {
    return this.previewInput !== null;
  }

  protected executeSerialize(): SerializedSchema {
    const serializeAnchorSchema = ():
      | SerializedRouteSchema
      | SerializedStringSchema
      | boolean
      | undefined => {
      if (this.options.a instanceof RouteSchema) {
        return this.options.a["executeSerialize"]() as SerializedRouteSchema;
      } else if (this.options.a instanceof StringSchema) {
        return this.options.a["executeSerialize"]() as SerializedStringSchema;
      } else {
        return this.options.a;
      }
    };
    const serializedOptions: SerializedRichTextOptions & ValidationOptions = {
      maxLength: this.options.maxLength,
      minLength: this.options.minLength,
      bold: this.options.bold,
      italic: this.options.italic,
      lineThrough: this.options.lineThrough,
      h1: this.options.h1,
      h2: this.options.h2,
      h3: this.options.h3,
      h4: this.options.h4,
      h5: this.options.h5,
      h6: this.options.h6,
      ul: this.options.ul,
      ol: this.options.ol,
      a: serializeAnchorSchema(),
      img:
        this.options.img && typeof this.options.img === "object"
          ? (this.options.img["executeSerialize"]() as SerializedImageSchema)
          : this.options.img,
    };
    return {
      type: "richtext",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      opt: this.opt,
      options: serializedOptions,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const richtext = <O extends RichTextOptions>(
  options?: O,
): RichTextSchema<O, RichTextSource<O>> => {
  return new RichTextSchema<O, RichTextSource<O>>(options ?? ({} as O));
};
