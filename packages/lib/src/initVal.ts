/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unnecessary-type-constraint */
import { content } from "./module";
import { i18n, I18n } from "./source/i18n";
import { InitSchema, initSchema, InitSchemaLocalized } from "./initSchema";
import { A, F } from "ts-toolbelt";
import { SelectorOf } from "./selector";
import { getValPath as getPath, Val } from "./val";
import { SelectorSource, GenericSelector } from "./selector";
import { JsonOfSource } from "./val";
import { fetchVal } from "./fetchVal";
import { remote } from "./source/remote";

type ValConstructor = {
  content: typeof content;
  getPath: typeof getPath; // TODO: in the react initVal we should also add a key function here which returns the path for use as react keys
  key: typeof getPath;
  remote: typeof remote;
};
export type InitVal<Locales extends readonly string[] | undefined> = [
  Locales
] extends [readonly string[]]
  ? {
      val: ValConstructor & {
        i18n: I18n<Locales>;
      };
      fetchVal<T extends SelectorSource>(
        selector: T,
        locale: Locales[number]
      ): SelectorOf<T> extends GenericSelector<infer S>
        ? Promise<Val<JsonOfSource<S>>>
        : never;
      s: InitSchema & InitSchemaLocalized<Locales>;
    }
  : {
      val: ValConstructor;
      fetchVal<T extends SelectorSource>(
        selector: T
      ): SelectorOf<T> extends GenericSelector<infer S>
        ? Promise<Val<JsonOfSource<S>>>
        : never;
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
      },
      fetchVal: fetchVal,
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
    },
    fetchVal: fetchVal,
    s: {
      ...s,
      i18n: undefined,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};
