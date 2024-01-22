import {
  initVal as createValSystem,
  type ValConfig,
  type InitVal,
  type ValConstructor,
  RichText,
  AnyRichTextOptions,
  ValModule,
  SelectorSource,
  Json,
  Internal,
} from "@valbuild/core";
import { raw } from "./raw";
import { decodeValPathOfString } from "./decodeValPathOfString";
import { ValEncodedString } from "./external_exempt_from_val_quickjs";

type ValAttrs = { "data-val-path"?: string };

export const initVal = (
  config?: ValConfig
): InitVal & {
  val: ValConstructor & {
    raw: typeof raw;
    attrs: <
      T extends ValModule<SelectorSource> | Json | RichText<AnyRichTextOptions>
    >(
      target: T
    ) => ValAttrs;
    unstable_decodeValPathOfString: typeof decodeValPathOfString;
  };
} => {
  const { s, c, val, config: systemConfig } = createValSystem();
  const currentConfig = {
    ...systemConfig,
    ...config,
    valConfigPath: config?.valConfigPath || "./val.config",
  };
  return {
    s,
    c,
    val: {
      ...val,
      attrs: <
        T extends
          | ValModule<SelectorSource>
          | Json
          | RichText<AnyRichTextOptions>
      >(
        target: T
      ): ValAttrs => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyTarget = target as any;
        let path: string | undefined;
        if (target === null) {
          return {};
        }
        path = Internal.getValPath(anyTarget);
        if (!path && typeof anyTarget === "object") {
          path = anyTarget["valPath"];
        }
        if (typeof anyTarget === "string") {
          path = decodeValPathOfString(anyTarget as ValEncodedString);
        }

        if (path) {
          return {
            "data-val-path": path,
          };
        }
        return {};
      },
      unstable_decodeValPathOfString: decodeValPathOfString,
      raw,
    },
    config: currentConfig,
  };
};
