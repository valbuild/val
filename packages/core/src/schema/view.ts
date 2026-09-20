import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import type { ModuleIdOf, ValModuleBrand } from "../module";
import { ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { GenericSelector } from "../selector";
import { Source } from "../source";
import { isValViewSource, ValViewSource } from "../source/view";
import { ModuleFilePath, SourcePath, getValPath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedValViewSchema = {
  type: "view";
  render?: FieldRender;
  /** Never set: a view has no value of its own to preview. Carried for shape parity. */
  preview?: true;
  /** Always false: a view points at a module, and `null` is not a module. */
  opt: false;
  /** Always false: there is no value for a custom validator to look at. */
  customValidate?: false;
  /** The module this field points at. */
  moduleFilePath: ModuleFilePath;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/** The source type of the module a selector points at. */
type SourceOf<M> = M extends GenericSelector<infer S> ? S : never;

/**
 * A field that points at ANOTHER module, for the Val editor's benefit.
 *
 * The source is `{ view: "/other.val.ts" }` — a pointer, and nothing else. The
 * module it names keeps its own source, its own patches, its own validation and
 * its own address; this field puts a row on THIS module's screen that an editor
 * clicks through to it.
 *
 * Two type parameters, each earning its place:
 *
 * - `Id` — the target's module file path as a literal, so the author writes
 *   `{ view: "/other.val.ts" }` with autocomplete, and naming a different module
 *   than the schema does is a type error rather than a validation error.
 * - `T` — the target's source type, carried on a phantom slot so the READ side
 *   can say `ValView<T>` rather than `ValView<unknown>`. Nothing reads it yet;
 *   it is here so that resolving a view through `useVal` can be added without
 *   changing what is stored.
 */
export class ValViewSchema<
  Id extends string = string,
  T = unknown,
> extends Schema<ValViewSource<Id, T>> {
  constructor(
    private readonly moduleFilePath: Id,
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * Shown next to the field's label in the Val editor — here, the place to say
   * WHY the other module is on this screen, since an editor who follows the row
   * is about to change content that other pages use too.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.view(otherVal).describe("Shared by every page"),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   shared: { view: "/other.val.ts" },
   *   title: "Hello",
   * });
   */
  describe(description: string | null): ValViewSchema<Id, T> {
    return new ValViewSchema(
      this.moduleFilePath,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
    );
  }

  /**
   * The stored pointer must name the module the SCHEMA names.
   *
   * It cannot disagree in a `.val.ts` — the source type is the literal path, so
   * a mismatch does not compile. It can disagree in hand-written JSON (a
   * `.jsonValues()` entry, an external record), which is what this is for.
   */
  protected executeValidate(
    path: SourcePath,
    src: ValViewSource<Id, T>,
  ): ValidationErrors {
    if (!isValViewSource(src)) {
      return {
        [path]: [
          {
            message: `Expected a view pointer ({ view: "${this.moduleFilePath}" }), got '${src === null ? "null" : typeof src}'`,
            value: src,
            fixes: ["view:check-module"],
          },
        ],
      };
    }
    if (src.view !== this.moduleFilePath) {
      return {
        [path]: [
          {
            message: `This view points at '${src.view}', but its schema says '${this.moduleFilePath}'`,
            value: src,
            fixes: ["view:check-module"],
          },
        ],
      };
    }
    return false;
  }

  protected executeCustomValidateAt(
    _path: SourcePath,
    _src: ValViewSource<Id, T>,
  ): ValidationError[] {
    return [];
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<ValViewSource<Id, T>> {
    if (isValViewSource(src)) {
      return { success: true, data: src } as SchemaAssertResult<
        ValViewSource<Id, T>
      >;
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `Expected a view pointer ({ view: string }), got '${src === null ? "null" : typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  /**
   * Not available: a view points at a module, and `null` is not a module.
   * Throws if called.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * // `s.view(otherVal).nullable()` throws — a view is never nullable.
   * const schema = s.object({ shared: s.view(otherVal), title: s.string() });
   * export default c.define("/example.val.ts", schema, {
   *   shared: { view: "/other.val.ts" },
   *   title: "Hello",
   * });
   */
  nullable(): Schema<ValViewSource<Id, T> | null> {
    throw new Error("s.view() cannot be nullable: it points at a module");
  }

  /**
   * Marks the row read-only.
   *
   * The view's OWN flag, and it says nothing about the module it names: that
   * module has its own `readonly`, which is what governs editing once an
   * editor is there. A view is a link rather than an editor, so this changes
   * nothing about the row today — it exists because every schema has it, and
   * because a view that renders its target inline would need it.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.view(otherVal).readonly(),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   shared: { view: "/other.val.ts" },
   *   title: "Hello",
   * });
   */
  readonly(isReadonly: boolean = true): ValViewSchema<Id, T> {
    return new ValViewSchema(
      this.moduleFilePath,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  /**
   * Hide the ROW in the editor.
   *
   * The view's OWN flag, and it is the only thing that decides whether the row
   * is drawn — a view whose TARGET is hidden is still shown, and still leads
   * there. That is the point of it: a module that many modules `keyOf` into is
   * noise in the nav and belongs on exactly one page, so it is hidden from the
   * listing and reached through the view that puts it where it belongs.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.view(otherVal).hidden(),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   shared: { view: "/other.val.ts" },
   *   title: "Hello",
   * });
   */
  hidden(isHidden: boolean = true): ValViewSchema<Id, T> {
    return new ValViewSchema(
      this.moduleFilePath,
      this.isReadonly,
      isHidden,
      this.description,
      this.renderInput,
    );
  }

  /**
   * How this field is laid out in the editor. Static configuration, not a
   * callback — see `render.ts`.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.view(otherVal).render({ as: "inline" }),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, {
   *   shared: { view: "/other.val.ts" },
   *   title: "Hello",
   * });
   */
  render(input: FieldRender): ValViewSchema<Id, T> {
    return new ValViewSchema(
      this.moduleFilePath,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "view",
      render: this.renderInput ?? undefined,
      opt: false,
      moduleFilePath: this.moduleFilePath as unknown as ModuleFilePath,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    } satisfies SerializedValViewSchema;
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

/**
 * Point at another module, so the Val editor shows a way into it from here.
 *
 * A view stores a pointer and nothing else: the module it names keeps its own
 * source, patches, validation and address, and an editor reaches it by clicking
 * through rather than by hunting for it. It is there so content that has to live
 * in its own module — a `keyOf` target, shared settings, a route-keyed record —
 * can still be found from the page it belongs to.
 *
 * Reading it in consuming code gives you a pointer with no fields on it. Read
 * the module it names directly instead.
 *
 * @example
 * import otherVal from "./other.val"; // another module
 * const schema = s.object({ shared: s.view(otherVal), title: s.string() });
 * export default c.define("/example.val.ts", schema, {
 *   shared: { view: "/other.val.ts" },
 *   title: "Hello",
 * });
 */
export const view = <
  // Same constraint as keyOf: a module, never a selector.
  M extends GenericSelector<Source> & ValModuleBrand,
>(
  valModule: M,
): ValViewSchema<ModuleIdOf<M>, SourceOf<M>> => {
  const path = getValPath(valModule);
  if (!path) {
    throw new Error("s.view() must be given a Val module");
  }
  return new ValViewSchema(path as unknown as ModuleIdOf<M>);
};
