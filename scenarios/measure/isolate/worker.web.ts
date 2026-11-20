/**
 * The probe with valbuild/web bundled in as well: `input=web`.
 *
 * `val-probe-web` is an alias in `wrangler.jsonc` for valbuild/web's
 * `val.modules.ts`, in a checkout beside this repository's (`../web`), and
 * `@valbuild/next` is aliased to `webNext.ts`. Deployed with `--env web`.
 */
import webModules from "val-probe-web";
import { createProbe } from "./probe";

export default createProbe({ web: webModules });
