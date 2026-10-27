import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ItemPreviewInput, PreviewItem } from "../preview";
import { NumberRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { isOnStep, NumberRules, stepOrigin } from "./numberRules";

/**
 * What the value has to be. `integer` is what makes a number schema an
 * `s.int()`: the source is a number either way, so an int is a number schema
 * with one more rule rather than a schema type of its own (which every walk
 * over a schema would have had to learn).
 */
type NumberOptions = NumberRules;

export type SerializedNumberSchema = {
  type: "number";
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: NumberOptions;
  /** How the field is edited. Static config — see `render.ts`. */
  render?: NumberRender;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class NumberSchema<Src extends number | null> extends Schema<Src> {
  constructor(
    private readonly options?: NumberOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    private readonly renderInput: NumberRender | null = null,
  ) {
    super();
    assertNumberSchemaIsConsistent(this.options, this.renderInput);
  }

  /**
   * Describe this field.
   *
   * The description is INPUT HELP: it is shown where this field's value is
   * entered — beside its input in the Val editor, and for a record's key
   * schema in every form that asks for a key — so it is where you say what an
   * editor needs to know to fill it in RIGHT, which the field name cannot
   * carry. It is not a name for the value: that is `.preview(...)`, and it is
   * read somewhere else. The description also travels in the serialized
   * schema, which is what the AI assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.number().describe("How many columns the grid uses");
   * export default c.define("/example.val.ts", schema, 3);
   */
  describe(description: string | null): NumberSchema<Src> {
    return new NumberSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.previewInput,
      this.renderInput,
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
   * @example
   * const schema = s.number().validate((val) =>
   *   Number.isInteger(val) ? false : "Must be a whole number",
   * );
   * export default c.define("/example.val.ts", schema, 3);
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): NumberSchema<Src> {
    return new NumberSchema(
      this.options,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
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
    if (typeof src !== "number") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'number', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    const errors: ValidationError[] = [...customValidationErrors];
    const options = this.options ?? {};
    // `!== undefined`, not truthiness: a bound of 0 is a bound. `.max(0)` and
    // `.min(0)` used to be ignored, which a slider from 0 makes common.
    if (options.max !== undefined && src > options.max) {
      errors.push({ message: `Must be at most ${options.max}`, value: src });
    }
    if (options.min !== undefined && src < options.min) {
      errors.push({ message: `Must be at least ${options.min}`, value: src });
    }
    if (options.integer && !Number.isInteger(src)) {
      errors.push({ message: "Must be a whole number", value: src });
    } else if (
      options.step !== undefined &&
      !isOnStep(src, stepOrigin(options), options.step)
    ) {
      errors.push({
        message: `Must be a multiple of ${options.step}, counted from ${stepOrigin(options)}`,
        value: src,
      });
    }
    if (errors.length > 0) {
      return { [path]: errors };
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
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected 'number', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src === "number") {
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
            message: `Expected 'number', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): NumberSchema<Src | null> {
    return new NumberSchema<Src | null>(
      this.options,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  readonly(isReadonly: boolean = true): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  hidden(isHidden: boolean = true): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  /**
   * Validate that the number is at most `max` (inclusive).
   *
   * @example
   * const schema = s.number().max(4);
   * export default c.define("/example.val.ts", schema, 3);
   */
  max(max: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, max },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  /**
   * Validate that the number is at least `min` (inclusive).
   *
   * @example
   * const schema = s.number().min(1).max(4);
   * export default c.define("/example.val.ts", schema, 3);
   */
  min(min: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, min },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  /**
   * Validate that the number is on a grid of `step`: one of `min`, `min + step`,
   * `min + 2 * step` and so on, counted from 0 when there is no `.min()`.
   *
   * A slider rendered on this field moves in the same steps unless its render
   * says otherwise (and then its step has to be a multiple of this one).
   *
   * @example
   * const schema = s.int().min(0).max(100).step(5);
   * export default c.define("/example.val.ts", schema, 40);
   */
  step(step: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, step },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.renderInput,
    );
  }

  /**
   * Choose how this field is edited. `{ as: "slider", min, max }` edits it with
   * a slider from `min` to `max`, next to a box for typing an exact value.
   *
   * `min` and `max` are required — a slider without ends is not a slider — and
   * they are the slider's, not validation: use `.min()` / `.max()` for what the
   * value may be. The slider can only produce values this schema accepts, so
   * its range must lie inside `.min()`/`.max()`, its `step` (which defaults to
   * `.step()`, then 1) must be a multiple of `.step()`, and on `s.int()` all of
   * them must be whole numbers. A schema that breaks this throws here.
   *
   * Static configuration, not a callback — see `render.ts`. A second
   * `.render(...)` replaces the first.
   *
   * @example
   * const schema = s.int().render({ as: "slider", min: 0, max: 100, step: 5 });
   * export default c.define("/example.val.ts", schema, 40);
   */
  render(input: NumberRender): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      input,
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
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.number().preview(({ val }) => ({ title: String(val) })),
   * );
   * export default c.define("/example.val.ts", schema, [1, 2]);
   */
  preview(select: ItemPreviewInput<Src>): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      select,
      this.renderInput,
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
      type: "number",
      preview: this.previewInput ? true : undefined,
      options: this.options,
      render: this.renderInput ?? undefined,
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }
}

export const number = (options?: NumberOptions): NumberSchema<number> => {
  return new NumberSchema(options) as NumberSchema<number>;
};

export const int = (): NumberSchema<number> => {
  return new NumberSchema({ integer: true }) as NumberSchema<number>;
};

/**
 * Throws when a number schema contradicts itself — above all when its slider
 * could produce a value the schema would then reject. Run by the constructor,
 * so it holds whatever order the methods were chained in: `.render(...).max(50)`
 * is checked as surely as `.max(50).render(...)`.
 *
 * Throwing at definition, rather than reporting a validation error, because
 * this is a mistake in the `.val.ts`, not in the content: no editor can fix it,
 * and every value they slide to would be the error.
 */
function assertNumberSchemaIsConsistent(
  options: NumberOptions | undefined,
  render: NumberRender | null,
): void {
  const opts = options ?? {};
  const kind = opts.integer ? "s.int()" : "s.number()";
  if (opts.step !== undefined) {
    if (!(opts.step > 0) || !Number.isFinite(opts.step)) {
      throw new Error(`${kind}.step(${opts.step}): the step must be above 0`);
    }
    if (opts.integer && !Number.isInteger(opts.step)) {
      throw new Error(
        `${kind}.step(${opts.step}): the step of an int must be a whole number`,
      );
    }
  }
  if (render === null) {
    return;
  }
  const where = `${kind}.render({ as: "slider", min: ${render.min}, max: ${render.max} })`;
  if (!Number.isFinite(render.min) || !Number.isFinite(render.max)) {
    throw new Error(`${where}: the slider needs a min and a max`);
  }
  if (!(render.min < render.max)) {
    throw new Error(`${where}: the slider's min must be below its max`);
  }
  if (opts.min !== undefined && render.min < opts.min) {
    throw new Error(
      `${where}: the slider's min ${render.min} is below the schema's min ${opts.min}`,
    );
  }
  if (opts.max !== undefined && render.max > opts.max) {
    throw new Error(
      `${where}: the slider's max ${render.max} is above the schema's max ${opts.max}`,
    );
  }
  if (render.step !== undefined && !(render.step > 0)) {
    throw new Error(`${where}: the slider's step must be above 0`);
  }
  if (opts.integer) {
    const sliderNumbers: [string, number | undefined][] = [
      ["min", render.min],
      ["max", render.max],
      ["step", render.step],
    ];
    for (const [name, value] of sliderNumbers) {
      if (value !== undefined && !Number.isInteger(value)) {
        throw new Error(
          `${where}: the slider's ${name} ${value} must be a whole number on an int`,
        );
      }
    }
  }
  if (opts.step !== undefined) {
    const sliderStep = render.step ?? opts.step;
    if (!isOnStep(sliderStep, 0, opts.step)) {
      throw new Error(
        `${where}: the slider's step ${sliderStep} must be a multiple of the schema's step ${opts.step}`,
      );
    }
    if (!isOnStep(render.min, stepOrigin(opts), opts.step)) {
      throw new Error(
        `${where}: the slider's min ${render.min} is not one of the schema's steps (${opts.step}, counted from ${stepOrigin(opts)})`,
      );
    }
  }
}
