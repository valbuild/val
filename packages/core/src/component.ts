import { Schema, SelectorOfSchema } from "./schema";
import { GetSchema, GetSource, Path, SelectorSource } from "./selector";
import { emptyOf } from "./schema/emptyOf";
import type { ValConfig } from "./initVal";
import { ModuleFilePath, SourcePath } from "./val";
import { ReplaceRawStringWithString, ValModule } from "./module";

/**
 * Symbol under which a component module stores its renderer.
 *
 * `Symbol.for` (like GetSource / GetSchema / Path) because the editor SPA and
 * the host app each ship their own copy of @valbuild/core: a unique symbol
 * would not be found across that bundle boundary.
 */
export const GetComponent = Symbol.for("@valbuild/core/GetComponent");

/**
 * The renderer of a component module.
 *
 * Typed loosely because core must stay free of React. `never` in the parameter
 * position accepts any component (function parameters are contravariant),
 * which lets @valbuild/next narrow `c.component` to a properly typed React
 * component while sharing this implementation.
 */
export type ValComponentRenderer = (props: never) => unknown;

/**
 * EXPERIMENTAL: define a module that also knows how to render itself.
 *
 * A component module is an ordinary Val module - it is registered in
 * `val.modules`, its source is validated, patched and published exactly like
 * `c.define` - except that it additionally carries the component that renders
 * the source. The Val UI uses this to show a live preview of the component
 * next to the fields, so an editor can see a section while editing it (and see
 * the result of a code change to the section itself).
 *
 * The last argument is default content: a fixture the preview falls back to
 * when the section is not used anywhere yet, and a good place for deliberately
 * unrepresentative values (very long names, empty lists) that make layout
 * problems easy to spot. It is an extra - the preview shows the component with
 * the content of every real usage too.
 *
 * It is optional. Omitted, the emptiest value the schema accepts is used, which
 * means a schema with constraints (`minLength`, ...) will report validation
 * errors on the component module until content is given.
 *
 * @example
 * // app/sections/hero.val.tsx
 * export const schema = s.object({ title: s.string() });
 *
 * function Hero({ title }: t.inferSchema<typeof schema>) {
 *   return <h1>{title}</h1>;
 * }
 *
 * export default c.component("/app/sections/hero.val.tsx", Hero, schema, {
 *   title: "Example title",
 * });
 */
export function component<T extends Schema<SelectorSource>>(
  id: string, // TODO: `/${string}` - and see if we can infer it from the file path
  component: ValComponentRenderer,
  schema: T,
  source?: ReplaceRawStringWithString<SelectorOfSchema<T>>,
): ValModule<SelectorOfSchema<T>> {
  return {
    [GetSource]:
      source === undefined ? emptyOf(schema["executeSerialize"]()) : source,
    [GetSchema]: schema,
    [Path]: id as SourcePath,
    [GetComponent]: component,
  } as unknown as ValModule<SelectorOfSchema<T>>;
}

/**
 * The renderer of a component module, or undefined if this is not a component
 * module. Returns `unknown` since core cannot express the React component type:
 * callers that render it must narrow it themselves.
 */
export function getComponent(module: unknown): unknown {
  if (typeof module === "object" && module !== null && GetComponent in module) {
    return module[GetComponent];
  }
  return undefined;
}

/**
 * True if this module was defined with `c.component` and can be previewed.
 */
export function isComponentModule(module: unknown): boolean {
  return typeof getComponent(module) === "function";
}

/**
 * Where the file of a module lives in the repository.
 *
 * Rewriting a component happens outside of Val, so this is the hand-off: it
 * says which file to change. It is split the same way the content service
 * addresses files - `root` (the app directory within the repo) plus the
 * module path - with the joined path for convenience.
 */
export type ValFileLocation = {
  /** Module file path, i.e. what `c.component` was given as its id. */
  modulePath: ModuleFilePath;
  /** `config.root`: the app directory within the repo, e.g. `/apps/my-app`. */
  root: string;
  /** `root` + `modulePath`: the file to change, relative to the repo root. */
  repoFilePath: string;
};

/**
 * The file that defines a module.
 *
 * For a component module this is the file that defines both the component and
 * its example content. If the component is imported into that file rather than
 * defined in it, this is still where to start - follow its imports.
 */
export function getValFileLocation(
  modulePath: ModuleFilePath,
  config: ValConfig | undefined,
): ValFileLocation {
  const root = (config?.root ?? "").replace(/\/$/, "");
  return {
    modulePath,
    root,
    repoFilePath: `${root}${modulePath}`,
  };
}
