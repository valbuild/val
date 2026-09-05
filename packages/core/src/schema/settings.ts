import { AssertError, Schema, SchemaAssertResult, SerializedSchema } from ".";
import { PreviewScope, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import {
  ASSISTANT_SETTINGS_MAX_LENGTH,
  AssistantSettingsSource,
  LocalesSettingsSource,
  SettingsSource,
} from "../source/settings";
import { ModuleFilePath, SourcePath } from "../val";
import { array } from "./array";
import { record } from "./record";
import { locale } from "./locale";
import { boolean } from "./boolean";
import { string } from "./string";
import { localeTagError } from "../locale";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedSettingsSchema = {
  type: "settings";
  /**
   * The sections this settings schema knows about, keyed by name.
   *
   * Carried in full rather than reconstructed from the Val version, so a Studio
   * that predates a section still deserializes the schema (it renders what it
   * recognises and leaves the rest alone) instead of failing on an unknown
   * shape.
   */
  items: Record<string, SerializedSchema>;
  opt: boolean;
  /**
   * Present in the shape, never set by `s.settings()`.
   *
   * `render` and `preview` say how a value is drawn where it is an ITEM of an
   * array or a record, and `customValidate` marks a user's `validate` closure. A
   * settings module is not an item, and `s.settings()` takes no arguments to
   * declare any of the three with — so nothing writes them.
   *
   * They are declared anyway, and with their real types rather than `never`, for
   * two reasons: reading `schema.render` off a `SerializedSchema` has to stay
   * legal (`isInlineRender` does exactly that), and a `?: never` member is typed
   * `undefined`, which makes the whole `SerializedSchema` union stop being
   * assignable to `Json` — and serialized schemas travel to the Studio and to
   * the MCP tools as JSON.
   */
  render?: FieldRender;
  preview?: true;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * An object whose keys are all optional: absent means unset.
 *
 * Both the settings module itself and each of its sections are this. See
 * {@link SettingsSource} for why settings cannot be an object schema, and
 * {@link settings} for what a settings module holds.
 *
 * There is no `describe`, `validate`, `render` or `preview` on purpose: the
 * shape is Val's, not the schema author's — `s.settings()` takes no arguments —
 * and the Studio renders each section with a UI built for it.
 */
export class SettingsSchema<
  Src extends { [key: string]: SelectorSource } | null,
> extends Schema<Src> {
  constructor(
    private readonly items: Record<string, Schema<SelectorSource>>,
    private readonly opt: boolean = false,
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    /**
     * Val's own rule about this section, across more than one of its keys.
     *
     * Not the `validate` the class deliberately does not offer: that one is the
     * schema author's, and `s.settings()` takes no arguments to declare it
     * with. This is Val stating a rule about a shape Val owns — `locales.default`
     * having to be one of `locales.available` is true of every project, and
     * there is nowhere else it can be said. A single field's rules stay on that
     * field's own schema; this is only for the ones that need a sibling.
     *
     * Errors carry a path WITHIN the section, so `default` is reported on
     * `default` and a bad tag on the entry that holds it, rather than all of
     * them landing on the section — which is not where the editor is looking.
     */
    private readonly sectionValidate?: (
      src: Record<string, unknown>,
    ) => { path: (string | number)[]; message: string }[],
  ) {
    super();
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;
    if (src === null || src === undefined) {
      if (this.opt) {
        return false;
      }
      return {
        [path]: [{ message: `Expected 'object', got '${src}'` }],
      } as ValidationErrors;
    }
    if (typeof src !== "object") {
      return {
        [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
      } as ValidationErrors;
    }
    if (Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'object', got 'array'` }],
      } as ValidationErrors;
    }
    for (const [key, schema] of Object.entries(this.items)) {
      // Absent is the unset value, so there is nothing to validate. A key that
      // is present as `undefined` is the same statement written differently.
      if (src[key] === undefined) {
        continue;
      }
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
    // An unknown key is reported rather than ignored (which is what an object
    // schema does with extra keys): the shape is closed and Val-defined, so the
    // realistic cause is a typo — `toneOfVoice` for `tone` — and silence there
    // means a setting that never takes effect and never says why.
    for (const key of Object.keys(src)) {
      if (!(key in this.items)) {
        error = this.appendValidationError(
          error,
          path,
          `Unknown settings key: '${key}'. Expected one of: ${Object.keys(
            this.items,
          )
            .map((key) => `'${key}'`)
            .join(", ")}`,
          src,
          true,
        );
      }
    }
    if (this.sectionValidate) {
      for (const { path: keys, message } of this.sectionValidate(src)) {
        let subPath: SourcePath | ModuleFilePath | undefined = path;
        for (const key of keys) {
          subPath = subPath && createValPathOfItem(subPath, key);
        }
        error = this.appendValidationError(
          error,
          // Falls back to the section itself, which is where an error belongs
          // when the value it is about is not addressable.
          (subPath as SourcePath | undefined) ?? path,
          message,
          src,
        );
      }
    }
    return error;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return { success: true, data: src } as SchemaAssertResult<Src>;
    }
    const typeError = (got: string): AssertError => ({
      message: `Expected 'object', got '${got}'`,
      typeError: true,
    });
    if (src === null) {
      return { success: false, errors: { [path]: [typeError("null")] } };
    }
    if (typeof src !== "object") {
      return { success: false, errors: { [path]: [typeError(typeof src)] } };
    }
    if (Array.isArray(src)) {
      return { success: false, errors: { [path]: [typeError("array")] } };
    }
    // No per-key check, unlike an object schema: every key is optional, so an
    // object is all this can assert.
    return { success: true, data: src } as SchemaAssertResult<Src>;
  }

  nullable(): SettingsSchema<Src | null> {
    return new SettingsSchema<Src | null>(
      this.items,
      true,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.sectionValidate,
    );
  }

  readonly(): SettingsSchema<Src> {
    return new SettingsSchema<Src>(
      this.items,
      this.opt,
      true,
      this.isHidden,
      this.description,
      this.sectionValidate,
    );
  }

  hidden(): SettingsSchema<Src> {
    return new SettingsSchema<Src>(
      this.items,
      this.opt,
      this.isReadonly,
      true,
      this.description,
      this.sectionValidate,
    );
  }

  protected override executeCustomValidateAt(): ValidationError[] {
    // Settings declares no `validate`, so there are no custom validators to
    // run. Implemented rather than inherited because the base class makes this
    // abstract on purpose — see `Schema.executeCustomValidateAt`.
    return [];
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "settings",
      items: Object.fromEntries(
        Object.entries(this.items).map(([key, schema]) => [
          key,
          schema["executeSerialize"](),
        ]),
      ),
      opt: this.opt,
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

/**
 * Define the project's settings.
 *
 * One settings module per project, at the root of the content tree — a module
 * file path with no directory segment, `/settings.val.ts` by convention:
 *
 * ```typescript
 * export default c.define("/settings.val.ts", s.settings(), {});
 * ```
 *
 * Every section is optional, so `{}` is a complete settings module and stays
 * one as sections are added. Fill in what the project needs:
 *
 * ```typescript
 * export default c.define("/settings.val.ts", s.settings(), {
 *   assistant: {
 *     enabled: true,
 *     context: "Val is a CMS for developers. British English, and 'Val' is never 'VAL'.",
 *     tone: "Plain and direct. No exclamation marks, sentence case in headings.",
 *   },
 * });
 * ```
 *
 * The Studio edits it under the cog at the foot of the left rail, and the
 * assistant is told `assistant.context` and `assistant.tone` on every message.
 *
 * `s.settings()` takes no arguments: the shape is Val's, which is what lets the
 * Studio render a UI built for each field rather than a generic form. A
 * project's own global content — a site name, social links — belongs in a
 * module of its own.
 */
export function settings(): SettingsSchema<SettingsSource> {
  return new SettingsSchema<SettingsSource>({
    assistant: new SettingsSchema<AssistantSettingsSource>({
      enabled: boolean()
        .nullable()
        .describe(
          "Whether editors have an assistant in this project. Unset means nobody has decided: it is offered, and turned on when someone accepts.",
        ),
      context: string()
        .multiline()
        .maxLength(ASSISTANT_SETTINGS_MAX_LENGTH)
        .nullable()
        .describe(
          "Background the assistant would otherwise have to guess: what this site is, who runs it, names and spellings that matter.",
        ),
      tone: string()
        .multiline()
        .maxLength(ASSISTANT_SETTINGS_MAX_LENGTH)
        .nullable()
        .describe(
          "How the assistant should write when it writes content: formal or playful, British or American, how headings are cased.",
        ),
      translation: record(
        locale(),
        string()
          .multiline()
          .maxLength(ASSISTANT_SETTINGS_MAX_LENGTH)
          .nullable(),
      )
        .nullable()
        .describe(
          "How to translate into each language: dialect, formality, and the words that stay untranslated.",
        ),
    }),
    locales: new SettingsSchema<LocalesSettingsSource>(
      {
        available: array(string()).describe(
          "The languages this project publishes, as BCP 47 tags: en-US, nb-NO. The first is where the Studio starts.",
        ),
        default: string()
          .nullable()
          .describe(
            "The language content is written in first, and the one translations are made from.",
          ),
      },
      false,
      false,
      false,
      undefined,
      localesSectionErrors,
    ),
  });
}

/**
 * The rules about `locales` that need more than one of its keys.
 *
 * Each tag's own spelling is checked by the field (see `localeTagError`); this
 * is what is left: a default has to name a language the project actually has,
 * and a language cannot be declared twice.
 *
 * Reads defensively rather than asserting the source's type. A settings module
 * is a file someone edits by hand, and validation runs against whatever is in
 * it — including the shapes the per-key pass is, in the same breath, reporting.
 */
function localesSectionErrors(
  src: Record<string, unknown>,
): { path: (string | number)[]; message: string }[] {
  const errors: { path: (string | number)[]; message: string }[] = [];
  const raw = Array.isArray(src["available"]) ? src["available"] : [];
  const available: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const tag = raw[i];
    if (typeof tag !== "string") {
      // The item's own schema has already said what is wrong with it.
      continue;
    }
    available.push(tag);
    const spelling = localeTagError(tag);
    if (spelling !== false) {
      errors.push({ path: ["available", i], message: spelling });
    } else if (seen.has(tag)) {
      errors.push({
        path: ["available", i],
        message: `'${tag}' is declared twice`,
      });
    }
    seen.add(tag);
  }
  const fallback = src["default"];
  if (typeof fallback === "string" && !seen.has(fallback)) {
    errors.push({
      path: ["default"],
      message:
        available.length === 0
          ? `'${fallback}' is not one of this project's languages, because none are declared`
          : `'${fallback}' is not one of this project's languages: ${available
              .map((tag) => `'${tag}'`)
              .join(", ")}`,
    });
  }
  return errors;
}
