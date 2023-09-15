import { cookies, draftMode, headers } from "next/headers";
import { transform, type StegaOfSource } from "@valbuild/react/stega";
import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  ModuleId,
} from "@valbuild/core";
import { ValApi } from "@valbuild/react";
import { result } from "@valbuild/core/fp";
import { Internal } from "@valbuild/core";
import { isValEnabled } from "./isValEnabled";

const valApiEndpoints = "/api/val"; // TODO: get from config
export function fetchVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<StegaOfSource<S>>
  : never {
  const host = getHost();
  const enabled = isValEnabled();
  if (host && safeDraftModeEnabled() && enabled) {
    // TODO: Use the content.val.build endpoints directly
    const api = new ValApi(`${host}${valApiEndpoints}`);

    // Optimize: only fetch the modules needed, also cache by module id and revalidate when patched
    // const valModuleIds = getModuleIds(selector);
    return api
      .getModules({
        patch: true,
        includeSource: true,
        headers: getValHeaders(),
      })
      .then((res) => {
        if (result.isOk(res)) {
          const { modules } = res.value;
          return transform(selector, {
            getModule: (moduleId) => {
              const module = modules[moduleId as ModuleId];
              if (module) {
                return module.source;
              }
            },
          });
        } else {
          console.error("Val: could not fetch modules", res.error);
        }
        return transform(selector, {});
      })
      .catch((err) => {
        console.error("Val: failed while checking modules", err);
        return selector;
      }) as SelectorOf<T> extends GenericSelector<infer S>
      ? Promise<StegaOfSource<S>>
      : never;
  }
  return transform(selector, {
    disabled: !enabled,
  });
}

function getHost() {
  // TODO: does NextJs have a way to determine this?
  try {
    const hs = headers();
    const host = hs.get("host");
    let proto = "https";
    if (hs.get("x-forwarded-proto") === "http") {
      proto = "http";
    } else if (hs.get("referer")?.startsWith("http://")) {
      proto = "http";
    } else if (host?.startsWith("localhost")) {
      proto = "http";
    }
    if (host && proto) {
      return `${proto}://${host}`;
    }
    return null;
  } catch (err) {
    console.error(
      "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
      err
    );
    return null;
  }
}

function getValHeaders(): Record<string, string> {
  try {
    const cs = cookies(); // TODO: simply get all headers?
    const session = cs.get(Internal.VAL_SESSION_COOKIE);
    if (session) {
      return {
        Cookie: `${Internal.VAL_SESSION_COOKIE}=${session.value}`,
      };
    }
    return {};
  } catch (err) {
    console.error(
      "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
      err
    );
    return {};
  }
}

function safeDraftModeEnabled() {
  try {
    return draftMode().isEnabled;
  } catch (err) {
    console.error(
      "Val: could read draft mode! fetchVal can only be used server-side. Use useVal on clients.",
      err
    );
    return false;
  }
}
