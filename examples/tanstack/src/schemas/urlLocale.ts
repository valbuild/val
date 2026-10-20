import { s } from "../../val.config";

/**
 * How a language is written in this site's URLs: `/nb/…` is Norwegian, and a
 * URL with no language segment is English.
 *
 * A schema, not configuration, so it lives with the schemas rather than in
 * `val.config.ts` — which is for setting Val up. Its own file because it is a
 * site-wide decision that every localized route module imports: each one has
 * to spell Norwegian the same way.
 *
 * `null` is a URL that leaves the `{-$locale}` segment out, which is why this is
 * only for router parameters: on a field, null means nobody chose a language.
 * See `src/routes/_site.{-$locale}.news.$slug.val.ts`.
 */
export const urlLocale = s
  .enum("nb")
  .nullable()
  .locales({ nb: "nb-NO" }, { null: "en-US" });
