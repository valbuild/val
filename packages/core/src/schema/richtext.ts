/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertError, Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ReifiedPreview } from "../preview";
import { unsafeCreateSourcePath } from "../selector/SelectorProxy";
import { ImageSource } from "../source/image";
import {
  RichTextSource,
  RichTextOptions,
  SerializedRichTextOptions,
} from "../source/richtext";
import { SourcePath } from "../val";
import { SerializedFileSchema } from "./file";
import { ImageSchema, SerializedImageSchema } from "./image";
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
  opt: boolean;
  options?: SerializedRichTextOptions & ValidationOptions;
};

export class RichTextSchema<
  O extends RichTextOptions,
  Src extends RichTextSource<O> | null,
> extends Schema<Src> {
  constructor(
    private readonly options: O & ValidationOptions,
    private readonly opt: boolean = false,
  ) {
    super();
  }

  maxLength(max: number): RichTextSchema<O, Src> {
    return new RichTextSchema(
      {
        ...this.options,
        maxLength: max,
      },
      this.opt,
    );
  }

  minLength(min: number): RichTextSchema<O, Src> {
    return new RichTextSchema(
      {
        ...this.options,
        minLength: min,
      },
      this.opt,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const assertRes = this.executeAssert(path, src);
    if (!assertRes.success) {
      return {
        [path]: assertRes.errors[path],
      };
    }
    const nodes = assertRes.data;
    if (nodes === null && this.opt) {
      return false;
    }
    if (nodes === null) {
      return {
        [path]: [
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
      return typeErrorRes;
    }
    if (Object.keys(current).length > 0) {
      return current;
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
        if (node.tag === "h1" && !this.options.block?.h1) {
          addError(path, `'h' block is not valid`, false);
        }
        if (node.tag === "h2" && !this.options.block?.h2) {
          addError(path, `'h2' block is not valid`, false);
        }
        if (node.tag === "h3" && !this.options.block?.h3) {
          addError(path, `'h3' block is not valid`, false);
        }
        if (node.tag === "h4" && !this.options.block?.h4) {
          addError(path, `'h4' block is not valid`, false);
        }
        if (node.tag === "h5" && !this.options.block?.h5) {
          addError(path, `'h5' block is not valid`, false);
        }
        if (node.tag === "h6" && !this.options.block?.h6) {
          addError(path, `'h6' block is not valid`, false);
        }
        if (node.tag === "ol" && !this.options.block?.ol) {
          addError(path, `'ol' block is not valid`, false);
        }
        if (node.tag === "ul" && !this.options.block?.ul) {
          addError(path, `'ul' block is not valid`, false);
        }
        if (
          node.tag === "li" &&
          !this.options.block?.ul &&
          !this.options.block?.ol
        ) {
          addError(
            path,
            `'li' tag is invalid since neither 'ul' nor 'ol' block is not valid`,
            false,
          );
        }
        if (node.tag === "a" && !this.options.inline?.a) {
          addError(path, `'a' inline is not valid`, false);
        }

        if (node.tag === "img") {
          if (!this.options.inline?.img) {
            addError(path, `'img' inline is not valid`, false);
          } else if (this.options.inline?.img) {
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
            const imageValidationErrors =
              typeof this.options.inline?.img === "object"
                ? this.options.inline?.img["executeValidate"](
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
            if (style === "bold" && !this.options.style?.bold) {
              addError(currentStylePath, `Style 'bold' is not valid`, false);
            }
            if (style === "italic" && !this.options.style?.italic) {
              addError(currentStylePath, `Style 'italic' is not valid`, false);
            }
            if (style === "lineThrough" && !this.options.style?.lineThrough) {
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
          const children = node.children;
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (typeof child === "object") {
              const childPath = unsafeCreateSourcePath(path, "children");
              const res = recurse(childPath, [child], current);
              if (res) {
                return res;
              }
            } else if (typeof child === "string") {
              length += child.length;
              continue;
            } else {
              return {
                [path]: [
                  {
                    message: `Expected 'object' or 'string', got '${typeof child}'`,
                    typeError: true,
                  },
                ],
              };
            }
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

  nullable(): Schema<Src | null> {
    return new RichTextSchema(this.options, true) as Schema<Src | null>;
  }

  protected executeSerialize(): SerializedSchema {
    const serializedOptions: SerializedRichTextOptions & ValidationOptions = {
      maxLength: this.options.maxLength,
      minLength: this.options.minLength,
      style: this.options.style,
      block: this.options.block,
      inline: this.options.inline && {
        a: this.options.inline.a,
        img:
          this.options.inline.img && typeof this.options.inline.img === "object"
            ? (this.options.inline.img[
                "executeSerialize"
              ]() as SerializedImageSchema)
            : this.options.inline.img,
      },
    };
    return {
      type: "richtext",
      opt: this.opt,
      options: serializedOptions,
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
