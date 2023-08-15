/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unnecessary-type-constraint */
import { content } from "./module";
import { i18n, I18n } from "./source/i18n";
import { InitSchema, initSchema, InitSchemaLocalized } from "./initSchema";
import { getValPath as getPath } from "./val";
import { remote } from "./source/remote";
import { file } from "./source/file";
import { richtext } from "./source/richtext";

type ValConstructor = {
  content: typeof content;
  getPath: typeof getPath;
  key: typeof getPath;
  remote: typeof remote;
  file: typeof file;
  richtext: typeof richtext;
};
export type InitVal<Locales extends readonly string[] | undefined> = [
  Locales
] extends [readonly string[]]
  ? {
      val: ValConstructor & {
        i18n: I18n<Locales>;
      };
      s: InitSchema & InitSchemaLocalized<Locales>;
    }
  : {
      val: ValConstructor;
      s: InitSchema;
    };

type NarrowStrings<A> =
  | (A extends [] ? [] : never)
  | (A extends string ? A : never)
  | {
      [K in keyof A]: NarrowStrings<A[K]>;
    };

export const initVal = <
  Locales extends readonly string[] | undefined
>(options?: {
  readonly locales?: NarrowStrings<{
    readonly required: Locales;
    readonly fallback: Locales extends readonly string[]
      ? Locales[number]
      : never;
  }>;
}): InitVal<Locales> => {
  const locales = options?.locales;
  const s = initSchema(locales?.required as readonly string[]);
  if (locales?.required) {
    console.error("Locales / i18n currently not implemented");
    return {
      val: {
        content,
        i18n,
        remote,
        getPath,
        key: getPath,
        file,
        richtext,
      },
      s,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  return {
    val: {
      content,
      remote,
      getPath,
      key: getPath,
      file,
      richtext,
    },
    s: {
      ...s,
      i18n: undefined,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};
