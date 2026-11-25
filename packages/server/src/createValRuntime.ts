import type { ValConfig, ValModules } from "@valbuild/core";
import { initHandlerOptions } from "./valServerConfig";
import { valRuntime, type ValRuntime } from "./valRuntime";
import type { ValApiOptions } from "./ValRouter";

/**
 * The runtime the draft readers read through (`initValContent`,
 * `initValRsc`): the same one `createValServer` builds its server on, for the
 * same `valModules` and options (`valRuntime`), so a save through the API
 * moves what the readers read. The readers read its head directly, with the
 * request's session (`ValRuntime.authorize`): no private server, and no
 * request to it.
 */
export async function createValRuntime(
  valModules: ValModules,
  route: string,
  opts: ValApiOptions,
  config: ValConfig,
): Promise<ValRuntime> {
  const valServerConfig = await initHandlerOptions(route, opts, config);
  return valRuntime(valModules, {
    ...(opts.versions?.framework && opts.versions.next
      ? {
          framework: {
            name: opts.versions.framework,
            version: opts.versions.next,
          },
        }
      : {}),
    ...valServerConfig,
  });
}
