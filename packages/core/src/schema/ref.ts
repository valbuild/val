import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ValModuleBrand } from "../module";
import { ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { GenericSelector } from "../selector";
import { Source } from "../source";
import { ModuleFilePath, SourcePath, getValPath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedRefSchema = {
  type: "ref";
  render?: FieldRender;
  /** Never set: a ref has no value to preview. Carried for shape parity. */
  preview?: true;
  /** Always false. Carried because call sites read `opt` off any serialized schema. */
  opt: false;
  /** Always false: a ref has no value, so there is nothing to validate. */
  customValidate?: false;
  /** The module this field shows. Nothing of it is stored here. */
  moduleFilePath: ModuleFilePath;
  /** Whether the referenced module may be edited from here. */
  editable: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * SPIKE. A field that shows ANOTHER module in this module's editor, and holds
 * no source of its own.
 *
 * `Src` is `never`, which is what removes it from the source: `ObjectSchemaSrcOf`
 * maps a ref key to `?: never`, so `c.define` neither wants nor accepts a value
 * for it, and consuming code that reads it gets `undefined`.
 */
export class RefSchema extends Schema<undefined> {
  /** Type-only marker, so `ObjectSchemaSrcOf` can pick ref keys out structurally. */
  declare readonly __isRef: true;

  constructor(
    private readonly moduleFilePath: ModuleFilePath,
    private readonly isEditable: boolean = false,
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
   * WHY the other module is on this screen, since an editor who changes it is
   * changing it everywhere it is used.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.ref(otherVal).describe("Shared by every page"),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  describe(description: string | null): RefSchema {
    return new RefSchema(
      this.moduleFilePath,
      this.isEditable,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
    );
  }

  /**
   * Allow the referenced module to be EDITED from here, not just seen.
   *
   * Off by default, and deliberately: the module is shown here for context, and
   * an edit made through this field changes it for every other page that uses
   * it. Turn it on where that is the point.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   title: s.string(),
   *   shared: s.ref(otherVal).editable(),
   * });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  editable(isEditable: boolean = true): RefSchema {
    return new RefSchema(
      this.moduleFilePath,
      isEditable,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  /** Nothing is stored, so there is nothing to validate. */
  protected executeValidate(
    _path: SourcePath,
    _src: undefined,
  ): ValidationErrors {
    return false;
  }

  protected executeCustomValidateAt(
    _path: SourcePath,
    _src: undefined,
  ): ValidationError[] {
    return [];
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<undefined> {
    if (src === undefined) {
      return { success: true, data: src } as SchemaAssertResult<undefined>;
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `A ref field stores nothing. Expected 'undefined', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  /**
   * Not available: a ref holds no value, so there is nothing for `null` to
   * mean. Throws if called.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * // `s.ref(otherVal).nullable()` throws — a ref is never nullable.
   * const schema = s.object({ shared: s.ref(otherVal), title: s.string() });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  nullable(): Schema<undefined | null> {
    throw new Error("s.ref() cannot be nullable: it holds no value");
  }

  /**
   * Show the referenced module, but never let it be changed from here.
   *
   * A ref is already read-only unless `.editable()` says otherwise; this states
   * it, and survives an `.editable()` written before it.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.ref(otherVal).readonly(),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  readonly(isReadonly: boolean = true): RefSchema {
    return new RefSchema(
      this.moduleFilePath,
      this.isEditable,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  /**
   * Hide this field in the editor.
   *
   * @example
   * import otherVal from "./other.val"; // another module
   * const schema = s.object({
   *   shared: s.ref(otherVal).hidden(),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  hidden(isHidden: boolean = true): RefSchema {
    return new RefSchema(
      this.moduleFilePath,
      this.isEditable,
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
   *   shared: s.ref(otherVal).render({ as: "inline" }),
   *   title: s.string(),
   * });
   * export default c.define("/example.val.ts", schema, { title: "Hello" });
   */
  render(input: FieldRender): RefSchema {
    return new RefSchema(
      this.moduleFilePath,
      this.isEditable,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "ref",
      render: this.renderInput ?? undefined,
      opt: false,
      moduleFilePath: this.moduleFilePath,
      editable: this.isEditable,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    } satisfies SerializedRefSchema;
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

/**
 * Show ANOTHER module as part of this one, in the Val editor.
 *
 * A ref stores nothing. It is a Studio-only field: the module it names keeps
 * its own source, its own patches, its own validation and its own address, and
 * this field puts it on THIS module's screen so an editor can see it in the
 * context it belongs to — a page's header, or the employee list that a page is
 * about.
 *
 * Because nothing is stored, the key is absent from the module's source and
 * reading it in consuming code gives `undefined`. Read the referenced module
 * directly instead, the way you did before.
 *
 * @example
 * import otherVal from "./other.val"; // another module
 * const schema = s.object({
 *   title: s.string(),
 *   // shown on the page's screen; edited in /data/employees.val.ts
 *   shared: s.ref(otherVal),
 * });
 * export default c.define("/example.val.ts", schema, { title: "Hello" });
 */
export const ref = <
  Src extends GenericSelector<Source> & ValModuleBrand, // same constraint as keyOf: a module, never a selector
>(
  valModule: Src,
): RefSchema => {
  const path = getValPath(valModule);
  if (!path) {
    throw new Error("s.ref() must be given a Val module");
  }
  return new RefSchema(path as unknown as ModuleFilePath);
};
