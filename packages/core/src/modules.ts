import { ValConfig } from "./initVal";
import { InferValModuleType, ValModule } from "./module";
import { SelectorSource } from "./selector";
import { ExternalLabelOf, ExternalRecordSrc } from "./source/external";

/**
 * One entry of `val.modules.ts`: a function that imports a module.
 *
 * @example
 * { def: () => import('./module.val') }
 */
export type ValModuleDef<
  M extends ValModule<SelectorSource> = ValModule<SelectorSource>,
> = {
  /**
   * A module definition defined as a function that returns a promise that resolves to the module.
   *
   * @example
   * { def: () => import('./module.val') }
   */
  def: () => Promise<{
    default: M;
  }>;
};

/**
 * The modules of a project, as `val.modules.ts` exports them.
 *
 * `Def` is what `modules()` was given, kept rather than widened, so that what a
 * project registers can be read back off the TYPE of its `val.modules.ts` -
 * which is how `initValServer` knows that a project with an `.external("posts")`
 * module must be handed an adapter for `posts` (see
 * {@link ExternalLabelsOfModules}).
 *
 * The default is the widest instantiation, so `ValModules` on its own still
 * means "any project's modules" and everything typed with it accepts a precise
 * one. An explicit `: ValModules` annotation on the export therefore opts out of
 * every check that reads `Def`.
 */
export type ValModules<Def extends ValModuleDef = ValModuleDef> = {
  config: ValConfig;
  modules: Def[];
};

/**
 * Define the set of modules that can be edited using the Val UI.
 *
 * @example
 * import { modules } from "@valbuild/next";
 * import { config } from "./val.config";
 *
 * export default modules(config, [
 *  { def: () => import("./app/page.val.ts") },
 *  { def: () => import("./app/another/page.val.ts") },
 * ]);
 */
export function modules<Def extends ValModuleDef>(
  config: ValConfig,
  modules: Def[],
): ValModules<Def> {
  return {
    config,
    modules,
  };
}

/**
 * A module whose entries live behind an adapter: what `c.define` returns for a
 * `s.record(...).external("label")` schema.
 *
 * It carries the three things an adapter is typed from - the item type, the
 * label it was declared with, and whether the schema said `.readonly()`:
 *
 * @example
 * // content/posts.val.ts
 * export default c.define(
 *   "/content/posts.val.ts",
 *   s.record(s.object({ title: s.string() })).external("posts"),
 *   c.external(),
 * );
 * // ...is a ValExternalModule<{ title: string }, "posts", false>
 */
export type ValExternalModule<
  Item = unknown,
  Label extends string = string,
  Readonly extends boolean = boolean,
> = ValModule<ExternalRecordSrc<Item, Label, Readonly>>;

/** The module a `val.modules.ts` entry imports. */
type ModuleOfDef<Def> = Def extends {
  def: () => Promise<{ default: infer M }>;
}
  ? M extends ValModule<SelectorSource>
    ? M
    : never
  : never;

/**
 * The label of every `.external(label)` module a project registers, as a union.
 *
 * `never` for a project that has none - and also when the module types are not
 * there to read: a JavaScript project, or a `val.modules.ts` whose export was
 * annotated as plain `ValModules`. That is the `string extends L` arm: a module
 * of unknown type could be anything, including external under any label, and
 * answering `string` would demand an adapter for every label there is. So an
 * unknown project is asked for nothing here, and the server's own startup check
 * is what covers it.
 *
 * @example
 * // val.modules.ts registers posts.val.ts (.external("posts")) and page.val.ts
 * type Labels = ExternalLabelsOfModules<typeof valModules>; // "posts"
 */
export type ExternalLabelsOfModules<Modules extends ValModules> =
  Modules extends ValModules<infer Def>
    ? ModuleOfDef<Def> extends infer M
      ? M extends ValModule<SelectorSource>
        ? ExternalLabelOf<InferValModuleType<M>> extends infer L
          ? L extends string
            ? string extends L
              ? never
              : L
            : never
          : never
        : never
      : never
    : never;
