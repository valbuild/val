/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AssertError,
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import {
  ItemPreviewInput,
  PreviewItem,
  ReifiedPreview,
  PreviewScope,
} from "../preview";
import { FieldRender } from "../render";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { ModuleFilePath, SourcePath } from "../val";
import { string } from "./string";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedObjectSchema = {
  type: "object";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  items: Record<string, SerializedSchema>;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

type ObjectSchemaProps = { [key: string]: Schema<SelectorSource> } & {
  /** Cannot create object with key: valPath. It is a reserved name */
  valPath?: never;
  /** Cannot create object with key: val. It is a reserved name */
  val?: never;
  /** Cannot create object with key: _type. It is a reserved name */
  _type?: never;
  /** Cannot create object with key: _ref. It is a reserved name */
  _ref?: never;
  // The ones below we might want to allow (they are no longer intended to be used):
  /** Cannot create object with key: andThen. It is a reserved name */
  andThen?: never;
  /** Cannot create object with key: assert. It is a reserved name */
  assert?: never;
  /** Cannot create object with key: fold. It is a reserved name */
  fold?: never;
  /** Cannot create object with key: patch_id. It is a reserved name */
  patch_id?: never;
};
type ObjectSchemaSrcOf<Props extends ObjectSchemaProps> = {
  [key in keyof Props]: SelectorOfSchema<Props[key]>;
};

export class ObjectSchema<
  Props extends ObjectSchemaProps,
  Src extends ObjectSchemaSrcOf<Props> | null,
> extends Schema<Src> {
  constructor(
    private readonly items: Props,
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

  /**
   * Describe this field.
   *
   * The description is shown next to the field's label in the Val editor, so
   * it is where you say what an editor needs to know but the field name cannot
   * carry. It also travels in the serialized schema, which is what the AI
   * assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s
   *   .object({ street: s.string(), city: s.string() })
   *   .describe("Where the office is — shown on the contact page");
   * export default c.define("/example.val.ts", schema, {
   *   street: "Torggata 1",
   *   city: "Oslo",
   * });
   */
  describe(description: string | null): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * Add a custom validation rule to this field.
   *
   * The function is called with the field's value and returns `false` when the
   * value is fine, or a STRING with the message to show when it is not. Call it
   * more than once to add more rules — they all run, and every message is
   * reported.
   *
   * Write the check as a ternary, not as `ok || "message"`: that returns `true`
   * when the value is fine, and `true` is not one of the two answers.
   *
   * Validation runs in the Studio as you type, in `npx val validate` and
   * before a publish.
   *
   * An object validator is the place for a rule that spans FIELDS — one field
   * validated on its own belongs on that field's schema, where the error lands
   * on the field itself.
   *
   * @example
   * const schema = s
   *   .object({ from: s.number(), to: s.number() })
   *   .validate((val) =>
   *     val.from <= val.to ? false : "'from' must not be after 'to'",
   *   );
   * export default c.define("/example.val.ts", schema, { from: 1, to: 4 });
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
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
        [path]: [{ message: `Expected 'object', got 'null'` }],
      } as ValidationErrors;
    }

    if (typeof src !== "object") {
      return {
        [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
      } as ValidationErrors;
    } else if (Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'object', got 'array'` }],
      } as ValidationErrors;
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
    for (const [key, schema] of Object.entries(this.items)) {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${key}`, // Should! never happen
          src,
        );
      } else {
        const subError = schema["executeValidate"](subPath, src[key]);
        error = this.mergeValidationErrors(error, subError);
      }
    }

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
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'null'`, typeError: true },
          ],
        },
      };
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
    } else if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'array'`, typeError: true },
          ],
        },
      };
    }

    const errorsAtPath: AssertError[] = [];
    for (const key of Object.keys(this.items)) {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        errorsAtPath.push({
          message: `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${key}`, // Should! never happen
          internalError: true,
        });
      } else if (!(key in src)) {
        errorsAtPath.push({
          message: `Expected key '${key}' not found in object`,
          typeError: true,
        });
      }
    }
    if (errorsAtPath.length > 0) {
      return {
        success: false,
        errors: {
          [path]: errorsAtPath,
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): ObjectSchema<Props, Src | null> {
    // Explicit type args: `previewInput` would otherwise pin inference to `Src`.
    return new ObjectSchema<Props, Src | null>(
      this.items,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
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
   *
   * @example
   * // A page builder: each row edits the object in place, instead of
   * // navigating to it.
   * const block = s
   *   .object({ heading: s.string(), body: s.string() })
   *   .render({ as: "inline" });
   * export default c.define("/example.val.ts", s.array(block), [
   *   { heading: "Hello", body: "World" },
   * ]);
   */
  render(input: FieldRender): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
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
   *
   * @example
   * const author = s
   *   .object({ name: s.string(), role: s.string() })
   *   .preview(({ val }) => ({ title: val.name, subtitle: val.role }));
   * export default c.define("/example.val.ts", s.array(author), [
   *   { name: "Ada", role: "Engineer" },
   * ]);
   */
  preview(select: ItemPreviewInput<Src>): ObjectSchema<Props, Src> {
    return new ObjectSchema(
      this.items,
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
    return {
      type: "object",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      items: Object.fromEntries(
        Object.entries(this.items).map(([key, schema]) => [
          key,
          schema["executeSerialize"](),
        ]),
      ),
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executePreview(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
    scope?: PreviewScope,
  ): ReifiedPreview {
    const res: ReifiedPreview = {};
    if (src === null) {
      return res;
    }
    for (const key in this.items) {
      const itemSrc = src[key];
      if (itemSrc === null || itemSrc === undefined) {
        continue;
      }
      const subPath = unsafeCreateSourcePath(sourcePath, key);
      // An object produces no preview of its own, so it is pure recursion — and
      // pruning it is the whole contribution: a field deep in one branch stops
      // paying for every sibling branch's previews.
      if (scope !== undefined && !scope.wantsUnder(subPath)) {
        continue;
      }
      const itemResult = this.items[key]["executePreview"](
        subPath,
        itemSrc,
        scope,
      );
      for (const keyS in itemResult) {
        const key = keyS as SourcePath | ModuleFilePath;
        res[key] = itemResult[key];
      }
    }
    return res;
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props,
): ObjectSchema<Props, ObjectSchemaSrcOf<Props>> => {
  return new ObjectSchema(schema);
};

const a = object({
  get test() {
    return string();
  },
});
