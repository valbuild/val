import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import {
  SvgOptions,
  SvgSource,
  SvgTag,
  SvgVariable,
  SVG_VAL_PATH,
  isSvgVarRef,
  svgVariableValue,
} from "../source/svg";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import {
  SVG_ASPECT_RATIO_EPSILON,
  SVG_DEFAULT_MAX_DEPTH,
  SVG_DEFAULT_MAX_NODES,
  SVG_ATTR_NAME_PATTERN,
  SVG_COLOR_ATTRS,
  SVG_ENUM_ATTRS,
  SVG_KEYWORD_COLORS,
  SVG_NUMBER_ATTRS,
  SVG_STRING_ATTRS,
  isAllowedSvgAttr,
  isSvgTag,
  parseSvgViewBox,
} from "./svg/allowlist";
import { unsafeCreateSourcePath } from "../selector/SelectorProxy";

export type SerializedSvgSchema = {
  type: "svg";
  options?: SvgOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

type SizeConstraint = number | { min?: number; max?: number };

function checkSize(
  actual: number,
  constraint: SizeConstraint | undefined,
): string | null {
  if (constraint === undefined) {
    return null;
  }
  if (typeof constraint === "number") {
    return actual === constraint
      ? null
      : `Expected ${constraint}, got ${actual}`;
  }
  if (constraint.min !== undefined && actual < constraint.min) {
    return `Expected at least ${constraint.min}, got ${actual}`;
  }
  if (constraint.max !== undefined && actual > constraint.max) {
    return `Expected at most ${constraint.max}, got ${actual}`;
  }
  return null;
}

function parseAspectRatio(
  aspectRatio: number | `${number}:${number}`,
): number | null {
  if (typeof aspectRatio === "number") {
    return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : null;
  }
  const parts = aspectRatio.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0 || w <= 0) {
    return null;
  }
  return w / h;
}

/**
 * Builds the CSS custom properties that back an svg schema's color variables.
 *
 * `ValSvg` renders `fill="var(--val-svg-<name>, currentColor)"`, so an app emits
 * this once - typically a `<style>` in the root layout - to make the schema's
 * example colors the ones that actually render. Overriding a variable in a
 * media query or a `[data-theme]` block is then all dark mode requires.
 *
 * @example
 * svgVarsCss(iconSchema)
 * // ":root{--val-svg-brand:#0055ff;--val-svg-line:currentColor}"
 */
export function svgVarsCss(
  schema:
    | SerializedSvgSchema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | SvgSchema<any, any>
    | SvgOptions,
  selector: string = ":root",
): string {
  const variables =
    schema instanceof SvgSchema
      ? // Bracket access: options is private, and this helper is the supported
        // way to read it. Same pattern as richtext / record use internally.
        schema["options"]?.variables
      : "type" in schema && schema.type === "svg"
        ? schema.options?.variables
        : (schema as SvgOptions).variables;
  if (!variables) {
    return "";
  }
  const declarations = Object.entries(variables)
    .map(
      ([name, variable]) =>
        `--val-svg-${name}:${svgVariableValue(variable as SvgVariable)}`,
    )
    .join(";");
  if (!declarations) {
    return "";
  }
  return `${selector}{${declarations}}`;
}

export class SvgSchema<
  O extends SvgOptions,
  Src extends SvgSource<O> | null,
> extends Schema<Src> {
  constructor(
    private readonly options: O,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
  ) {
    super();
  }

  private copy(
    overrides: Partial<{
      options: O;
      opt: boolean;
      customValidateFunctions: CustomValidateFunction<Src>[];
      isReadonly: boolean;
      isHidden: boolean;
      description: string | undefined;
    }> = {},
  ): SvgSchema<O, Src> {
    return new SvgSchema<O, Src>(
      overrides.options ?? this.options,
      overrides.opt ?? this.opt,
      overrides.customValidateFunctions ?? this.customValidateFunctions,
      overrides.isReadonly ?? this.isReadonly,
      overrides.isHidden ?? this.isHidden,
      "description" in overrides ? overrides.description : this.description,
    );
  }

  describe(description: string | null): SvgSchema<O, Src> {
    return this.copy({ description: description ?? undefined });
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): SvgSchema<O, Src> {
    return this.copy({
      customValidateFunctions: [
        ...this.customValidateFunctions,
        validationFunction,
      ],
    });
  }

  /** Require an exact intrinsic width, or a range. Constrains the viewBox. */
  width(width: SizeConstraint): SvgSchema<O, Src> {
    return this.copy({ options: { ...this.options, width } });
  }

  /** Require an exact intrinsic height, or a range. Constrains the viewBox. */
  height(height: SizeConstraint): SvgSchema<O, Src> {
    return this.copy({ options: { ...this.options, height } });
  }

  /** Require a viewBox aspect ratio, as a number or `"w:h"`. */
  aspectRatio(aspectRatio: number | `${number}:${number}`): SvgSchema<O, Src> {
    return this.copy({ options: { ...this.options, aspectRatio } });
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? ({ [path]: customValidationErrors } as ValidationErrors)
        : false;
    }
    let errors: ValidationErrors = false;
    if (customValidationErrors.length > 0) {
      errors = { [path]: customValidationErrors } as ValidationErrors;
    }
    if (src === null || src === undefined) {
      return this.appendValidationError(
        errors,
        path,
        "Expected 'object', got 'null'",
        src,
      );
    }
    if (typeof src !== "object" || Array.isArray(src)) {
      return this.appendValidationError(
        errors,
        path,
        `Expected 'object', got '${Array.isArray(src) ? "array" : typeof src}'`,
        src,
      );
    }
    errors = this.validateGeometry(path, src, errors);
    if (!Array.isArray(src.children)) {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "children"),
        `Expected 'array' of svg nodes, got '${typeof src.children}'`,
        src.children,
      );
    }
    const counters = {
      nodes: 0,
      maxNodes: this.options.maxNodes ?? SVG_DEFAULT_MAX_NODES,
      maxDepth: this.options.maxDepth ?? SVG_DEFAULT_MAX_DEPTH,
      exceeded: false,
    };
    errors = this.validateNodes(
      unsafeCreateSourcePath(path, "children"),
      src.children,
      1,
      counters,
      errors,
    );
    if (counters.exceeded) {
      errors = this.appendValidationError(
        errors,
        path,
        `Svg has too many nodes: max is ${counters.maxNodes}`,
        undefined,
      );
    }
    return errors;
  }

  private validateGeometry(
    path: SourcePath,
    src: SvgSource<O>,
    errors: ValidationErrors,
  ): ValidationErrors {
    if (typeof src.viewBox !== "string") {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "viewBox"),
        `Expected 'string', got '${typeof src.viewBox}'`,
        src.viewBox,
      );
    }
    const viewBox = parseSvgViewBox(src.viewBox);
    if (!viewBox) {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "viewBox"),
        `Invalid viewBox: expected 4 numbers ('min-x min-y width height') with a non-negative width and height, got '${src.viewBox}'`,
        src.viewBox,
      );
    }
    const widthError = checkSize(viewBox.width, this.options.width);
    if (widthError) {
      errors = this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "viewBox"),
        `Invalid viewBox width. ${widthError}`,
        src.viewBox,
      );
    }
    const heightError = checkSize(viewBox.height, this.options.height);
    if (heightError) {
      errors = this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "viewBox"),
        `Invalid viewBox height. ${heightError}`,
        src.viewBox,
      );
    }
    if (this.options.aspectRatio !== undefined) {
      const expected = parseAspectRatio(this.options.aspectRatio);
      if (expected === null) {
        errors = this.appendValidationError(
          errors,
          path,
          `Invalid aspectRatio in schema: '${this.options.aspectRatio}'`,
          src.viewBox,
          true,
        );
      } else if (viewBox.height === 0) {
        errors = this.appendValidationError(
          errors,
          unsafeCreateSourcePath(path, "viewBox"),
          "Cannot check aspect ratio: viewBox height is 0",
          src.viewBox,
        );
      } else {
        const actual = viewBox.width / viewBox.height;
        if (Math.abs(actual - expected) > SVG_ASPECT_RATIO_EPSILON) {
          errors = this.appendValidationError(
            errors,
            unsafeCreateSourcePath(path, "viewBox"),
            `Invalid aspect ratio: expected ${this.options.aspectRatio}, got ${viewBox.width}:${viewBox.height}`,
            src.viewBox,
          );
        }
      }
    }
    for (const key of ["width", "height"] as const) {
      const value = src[key];
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors = this.appendValidationError(
          errors,
          unsafeCreateSourcePath(path, key),
          `Expected a non-negative number or null, got '${JSON.stringify(value)}'`,
          value,
        );
        continue;
      }
      const error = checkSize(value, this.options[key]);
      if (error) {
        errors = this.appendValidationError(
          errors,
          unsafeCreateSourcePath(path, key),
          `Invalid ${key}. ${error}`,
          value,
        );
      }
    }
    return errors;
  }

  private validateNodes(
    path: SourcePath,
    nodes: unknown[],
    depth: number,
    counters: {
      nodes: number;
      maxNodes: number;
      maxDepth: number;
      exceeded: boolean;
    },
    errors: ValidationErrors,
  ): ValidationErrors {
    for (let i = 0; i < nodes.length; i++) {
      const nodePath = unsafeCreateSourcePath(path, i);
      counters.nodes++;
      if (counters.nodes > counters.maxNodes) {
        counters.exceeded = true;
        return errors;
      }
      errors = this.validateNode(nodePath, nodes[i], depth, counters, errors);
    }
    return errors;
  }

  private validateNode(
    path: SourcePath,
    node: unknown,
    depth: number,
    counters: {
      nodes: number;
      maxNodes: number;
      maxDepth: number;
      exceeded: boolean;
    },
    errors: ValidationErrors,
  ): ValidationErrors {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      return this.appendValidationError(
        errors,
        path,
        `Expected an svg node object, got '${node === null ? "null" : Array.isArray(node) ? "array" : typeof node}'`,
        node,
      );
    }
    if (depth > counters.maxDepth) {
      return this.appendValidationError(
        errors,
        path,
        `Svg is nested too deeply: max depth is ${counters.maxDepth}`,
        undefined,
      );
    }
    const candidate = node as {
      tag?: unknown;
      attrs?: unknown;
      children?: unknown;
    };
    if (typeof candidate.tag !== "string") {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "tag"),
        `Expected 'string', got '${typeof candidate.tag}'`,
        candidate.tag,
      );
    }
    if (!isSvgTag(candidate.tag)) {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "tag"),
        `Tag '${candidate.tag}' is not supported`,
        candidate.tag,
      );
    }
    const tag: SvgTag = candidate.tag;
    errors = this.validateAttrs(
      unsafeCreateSourcePath(path, "attrs"),
      tag,
      candidate.attrs,
      errors,
    );
    if (candidate.children === undefined) {
      return errors;
    }
    if (!Array.isArray(candidate.children)) {
      return this.appendValidationError(
        errors,
        unsafeCreateSourcePath(path, "children"),
        `Expected 'array' of svg nodes, got '${typeof candidate.children}'`,
        candidate.children,
      );
    }
    return this.validateNodes(
      unsafeCreateSourcePath(path, "children"),
      candidate.children,
      depth + 1,
      counters,
      errors,
    );
  }

  private validateAttrs(
    path: SourcePath,
    tag: SvgTag,
    attrs: unknown,
    errors: ValidationErrors,
  ): ValidationErrors {
    if (attrs === undefined) {
      return errors;
    }
    if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs)) {
      return this.appendValidationError(
        errors,
        path,
        `Expected 'object' of attributes, got '${Array.isArray(attrs) ? "array" : typeof attrs}'`,
        attrs,
      );
    }
    for (const [name, value] of Object.entries(attrs)) {
      const attrPath = unsafeCreateSourcePath(path, name);
      if (!SVG_ATTR_NAME_PATTERN.test(name)) {
        errors = this.appendValidationError(
          errors,
          attrPath,
          `Invalid attribute name: '${name}'`,
          value,
        );
        continue;
      }
      if (!isAllowedSvgAttr(tag, name)) {
        errors = this.appendValidationError(
          errors,
          attrPath,
          `Attribute '${name}' is not supported on '${tag}'`,
          value,
        );
        continue;
      }
      errors = this.validateAttrValue(attrPath, name, value, errors);
    }
    return errors;
  }

  private validateAttrValue(
    path: SourcePath,
    name: string,
    value: unknown,
    errors: ValidationErrors,
  ): ValidationErrors {
    if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
      return this.validateColor(path, name, value, errors);
    }
    if ((SVG_NUMBER_ATTRS as readonly string[]).includes(name)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return this.appendValidationError(
          errors,
          path,
          `Expected a finite 'number' for '${name}', got '${typeof value}'`,
          value,
        );
      }
      return errors;
    }
    if (name in SVG_ENUM_ATTRS) {
      const allowed = SVG_ENUM_ATTRS[name as keyof typeof SVG_ENUM_ATTRS];
      if (
        typeof value !== "string" ||
        !(allowed as readonly string[]).includes(value)
      ) {
        return this.appendValidationError(
          errors,
          path,
          `Invalid '${name}': expected one of ${(allowed as readonly string[]).map((v) => `'${v}'`).join(", ")}, got '${JSON.stringify(value)}'`,
          value,
        );
      }
      return errors;
    }
    if (name in SVG_STRING_ATTRS) {
      const { pattern, maxLength } =
        SVG_STRING_ATTRS[name as keyof typeof SVG_STRING_ATTRS];
      if (typeof value !== "string") {
        return this.appendValidationError(
          errors,
          path,
          `Expected 'string' for '${name}', got '${typeof value}'`,
          value,
        );
      }
      if (value.length > maxLength) {
        return this.appendValidationError(
          errors,
          path,
          `'${name}' is too long: max is ${maxLength} characters, got ${value.length}`,
          value,
        );
      }
      if (!pattern.test(value)) {
        return this.appendValidationError(
          errors,
          path,
          `Invalid '${name}': contains unsupported characters`,
          value,
        );
      }
      return errors;
    }
    return this.appendValidationError(
      errors,
      path,
      `Attribute '${name}' is not supported`,
      value,
    );
  }

  private validateColor(
    path: SourcePath,
    name: string,
    value: unknown,
    errors: ValidationErrors,
  ): ValidationErrors {
    if (isSvgVarRef(value)) {
      const variables = this.options.variables ?? {};
      if (!(value.var in variables)) {
        const declared = Object.keys(variables);
        return this.appendValidationError(
          errors,
          path,
          declared.length > 0
            ? `Unknown color variable '${value.var}'. Declared variables: ${declared.join(", ")}`
            : `Unknown color variable '${value.var}'. This schema declares no variables`,
          value,
        );
      }
      return errors;
    }
    if (typeof value !== "string") {
      return this.appendValidationError(
        errors,
        path,
        `Expected a color variable ({ var: ... }) or a color string for '${name}', got '${typeof value}'`,
        value,
      );
    }
    if (SVG_KEYWORD_COLORS.includes(value)) {
      return errors;
    }
    const literals = this.options.literals ?? "forbid";
    if (literals === "allow") {
      return errors;
    }
    const declared = Object.keys(this.options.variables ?? {});
    if (literals === "forbid") {
      return this.appendValidationError(
        errors,
        path,
        declared.length > 0
          ? `Raw color '${value}' is not allowed. Use one of the declared variables: ${declared.join(", ")}`
          : `Raw color '${value}' is not allowed. Declare a color variable, or set literals to allow raw colors`,
        value,
      );
    }
    if (!literals.includes(value)) {
      return this.appendValidationError(
        errors,
        path,
        `Raw color '${value}' is not allowed. Allowed raw colors: ${literals.join(", ")}`,
        value,
      );
    }
    return errors;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return { success: true, data: src } as SchemaAssertResult<Src>;
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: "Expected 'object', got 'null'", typeError: true },
          ],
        },
      };
    }
    if (typeof src !== "object" || Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'object', got '${Array.isArray(src) ? "array" : typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!("viewBox" in src) || typeof src.viewBox !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            { message: "Expected an svg with a 'viewBox'", typeError: true },
          ],
        },
      };
    }
    if (!("children" in src) || !Array.isArray(src.children)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected an svg with an array of 'children'",
              typeError: true,
            },
          ],
        },
      };
    }
    return { success: true, data: src } as SchemaAssertResult<Src>;
  }

  nullable(): SvgSchema<O, Src | null> {
    return new SvgSchema<O, Src | null>(
      this.options,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
    );
  }

  readonly(): SvgSchema<O, Src> {
    return this.copy({ isReadonly: true });
  }

  hidden(): SvgSchema<O, Src> {
    return this.copy({ isHidden: true });
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "svg",
      options: this.options,
      opt: this.opt,
      customValidate:
        this.customValidateFunctions && this.customValidateFunctions.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const svg = <O extends SvgOptions>(
  options?: O,
): SvgSchema<O, SvgSource<O>> => {
  return new SvgSchema<O, SvgSource<O>>((options ?? {}) as O);
};

export { SVG_VAL_PATH };
