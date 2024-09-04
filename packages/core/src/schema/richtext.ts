/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertError, Schema, SchemaAssertResult, SerializedSchema } from ".";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { RichTextSource, RichTextOptions } from "../source/richtext";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRichTextSchema = {
  type: "richtext";
  opt: boolean;
  options?: RichTextOptions;
};

export class RichTextSchema<
  O extends RichTextOptions,
  Src extends RichTextSource<O> | null,
> extends Schema<Src> {
  constructor(
    readonly options: O,
    readonly opt: boolean = false,
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((src as any)?.markdownish) {
      return {
        [path]: [
          {
            message: "Replace markdown with structured format",
            value: src,
            fixes: ["fix:deprecated-richtext"],
          },
        ],
      };
    }
    const assertRes = this.assert(path, src);
    if (!assertRes.success) {
      return {
        [path]: assertRes.errors[path],
      };
    }
    // TODO validate options
    return false;
  }

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
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
    // TODO: validate options
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

  serialize(): SerializedSchema {
    return {
      type: "richtext",
      opt: this.opt,
      options: this.options,
    };
  }
}

export const richtext = <O extends RichTextOptions>(
  options?: O,
): Schema<RichTextSource<O>> => {
  return new RichTextSchema<O, RichTextSource<O>>(options ?? ({} as O));
};
