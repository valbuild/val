import { define } from "./module";
import { InitSchema, initSchema } from "./initSchema";
import { getValPath as getPath } from "./val";
import { json } from "./source/json";
import { external } from "./source/external";
// import { i18n, I18n } from "./source/future/i18n";
// import { remote } from "./source/future/remote";

export type ContentConstructor = {
  /**
   * Define a content module: a schema, and source that matches it.
   *
   * The first argument is the module's own file path, starting at the root of
   * the project. It has to match the file the call is written in - that is how
   * the Studio, validation and patching find the module again - so a
   * `c.define` is always the default export of one `*.val.ts` file.
   *
   * @example
   * const schema = s.object({ title: s.string() });
   * export default c.define("/content/page.val.ts", schema, {
   *   title: "Hello",
   * });
   */
  define: typeof define;
  /**
   * Put one entry of a `.jsonValues()` record in its own `*.val.json` file,
   * loaded lazily.
   *
   * What is written in the module is the `import()` thunk, not the content: the
   * `.val.ts` stays small, and the runtime, the Studio and validation each work
   * an entry at a time. That is what lets a record or a router hold many
   * thousands of entries.
   *
   * Only for the entries of a record that said `.jsonValues()`.
   *
   * @example
   * import { nextAppRouter } from "../val.config";
   * const schema = s
   *   .router(nextAppRouter, s.object({ title: s.string() }))
   *   .jsonValues();
   * export default c.define("/app/support/[slug]/page.val.ts", schema, {
   *   "/support/faq": c.json(() => import("./content/faq.val.json")),
   * });
   */
  json: typeof json;
  /**
   * The source of a record whose entries live behind an adapter - a database,
   * an HTTP API, a bucket - instead of in the module.
   *
   * It takes no arguments, and there is nothing to fill in: it says only that
   * the entries are somewhere else. WHICH adapter is the schema's business
   * (`.external("posts")`), and the binding is registered where the app is set
   * up.
   *
   * @example
   * const schema = s.record(s.object({ title: s.string() })).external("posts");
   * export default c.define("/content/posts.val.ts", schema, c.external());
   */
  external: typeof external;
};
export type ValConstructor = {
  /**
   * The source path of a value inside a module, or `null` for something that
   * did not come from Val.
   *
   * A path is what every Val API addresses content by, so this is the way from
   * a value you are holding back to the thing the Studio, a patch or a
   * validation error names. Unstable: the shape of a path is not part of the
   * public API yet.
   *
   * @example
   * import pageVal from "./page.val";
   * const path = val.unstable_getPath(pageVal); // "/page.val.ts"
   */
  unstable_getPath: typeof getPath;
};

export type ConfigDirectory = `/public` | `/public/${string}`;

export type ValConfig = {
  project?: string;
  root?: string;
  files?: {
    directory: ConfigDirectory;
  };
  gitCommit?: string;
  gitBranch?: string;
  defaultTheme?: "dark" | "light";
  ai?: {
    /**
     * The AI commit-message summariser.
     *
     * Still config, and deliberately: it is about how the repository is
     * written to rather than about the content, and it is getting settings of
     * its own. The ASSISTANT is not here — it is `s.settings()`, under
     * `assistant.enabled`, because whether editors have a chat is a decision
     * about the
     * project's content, made by the people who edit it, and published like any
     * other content change.
     */
    commitMessages?: {
      disabled?: boolean;
    };
  };
};
export type InitVal = {
  /**
   * The content constructor: `c.define` for a module, `c.json` and
   * `c.external` for entries that live outside it.
   *
   * @example
   * const schema = s.object({ title: s.string() });
   * export default c.define("/content/page.val.ts", schema, {
   *   title: "Hello",
   * });
   */
  c: ContentConstructor;
  /**
   * Helpers for working with content your app is already holding, rather than
   * for declaring it.
   *
   * `@valbuild/next` and `@valbuild/tanstack` add to this: `val.attrs` for
   * visual editing, `val.raw` to strip the stega encoding off a string.
   *
   * @example
   * import pageVal from "./page.val";
   * const path = val.unstable_getPath(pageVal);
   */
  val: ValConstructor;
  /**
   * The schema constructor: one method per type of content Val can hold.
   *
   * @example
   * const schema = s.object({
   *   title: s.string().describe("Shown in the browser tab"),
   *   image: s.image().nullable(),
   * });
   * export default c.define("/content/page.val.ts", schema, {
   *   title: "Hello",
   *   image: null,
   * });
   */
  s: InitSchema;
  /**
   * The config this `initVal` was called with, as the rest of Val reads it.
   *
   * Exported from `val.config.ts` so that the Val API route and the Studio get
   * the same object the content modules were built with.
   *
   * @example
   * import { initVal } from "@valbuild/core";
   * const { s, c, val, config } = initVal({
   *   project: "myorg/myproject",
   *   files: { directory: "/public/val" },
   * });
   * export { s, c, val, config };
   */
  config: ValConfig;
};

// type NarrowStrings<A> =
//   | (A extends [] ? [] : never)
//   | (A extends string ? A : never)
//   | {
//       [K in keyof A]: NarrowStrings<A[K]>;
//     };

// TODO: Rename to createValSystem (only to be used by internal things), we can then export * from '@valbuild/core' in the next package then.
export const initVal = (
  config?: ValConfig,
): //   options?: {
//   readonly locales?: NarrowStrings<{
//     readonly required: Locales;
//     readonly default: Locales extends readonly string[]
//       ? Locales[number]
//       : never;
//   }>;
// }
InitVal => {
  // const locales = options?.locales;
  const s = initSchema();
  // if (locales?.required) {
  //   console.error("Locales / i18n currently not implemented");
  //   return {
  //     val: {
  //       content,
  //       i18n,
  //       remote,
  //       getPath,
  //       file,
  //       richtext,
  //     },
  //     s,
  //     config: {},
  //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //   } as any;
  // }
  return {
    val: {
      unstable_getPath: getPath,
    },
    c: {
      define,
      json,
      external,
    },
    s,
    config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};
