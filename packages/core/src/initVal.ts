/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unnecessary-type-constraint */
import { define } from "./module";
import { InitSchema, initSchema } from "./initSchema";
import { getValPath as getPath } from "./val";
import { initFile } from "./source/file";
import { initImage } from "./source/image";
// import { i18n, I18n } from "./source/future/i18n";
// import { remote } from "./source/future/remote";

export type ContentConstructor = {
  define: typeof define;
  // remote: typeof remote;
  file: ReturnType<typeof initFile>;
  image: ReturnType<typeof initImage>;
};
export type ValConstructor = {
  unstable_getPath: typeof getPath;
};

export type ConfigDirectory = `/public/val`;

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
    commitMessages?: {
      disabled?: boolean;
    };
  };
};
export type InitVal = {
  c: ContentConstructor;
  val: ValConstructor;
  s: InitSchema;
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
      getPath,
    },
    c: {
      define,
      // remote,
      file: initFile(config),
      image: initImage(config),
    },
    s,
    config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};
