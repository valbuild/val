import { initVal } from "@valbuild/tanstack";

const { s, c, val, config, tanstackRouter, externalPageRouter } = initVal({
  project: "valbuild/val-examples-tanstack",
  root: "/examples/tanstack",
  defaultTheme: "dark",
});

/**
 * How a language is written in this site's URLs: `/nb/…` is Norwegian, and a
 * URL with no language segment is English.
 *
 * Defined once, here, because it is a site-wide decision — every localized
 * route spells Norwegian the same way. `null` is a URL that leaves the
 * `{-$locale}` segment out, which is why it is only for router parameters: on a
 * field, null means nobody chose a language. See
 * `src/routes/_site.{-$locale}.news.$slug.val.ts`.
 */
const urlLocale = s
  .enum("nb")
  .nullable()
  .locales({ nb: "nb-NO" }, { null: "en-US" });

export type { t } from "@valbuild/tanstack";
export { s, c, val, config, tanstackRouter, externalPageRouter, urlLocale };
