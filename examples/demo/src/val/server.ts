import { initValDemoServer } from "@valbuild/tanstack/demo";
import { config } from "../../val.config";
import valModules from "../../val.modules";
import { isDemo } from "../demo";

/**
 * The Val API route.
 *
 * In the demo it serves the Studio's own files and nothing else: the API runs
 * in the visitor's tab. Otherwise this is an ordinary local Val project, which
 * is how the demo's content is edited (`VITE_VAL_DEMO=false pnpm dev`).
 *
 * The full server is loaded only when it is wanted. Importing it loads all of
 * Val's server, the TypeScript compiler included, and a demo needs none of it.
 */
const handler: Promise<(req: Request) => Promise<Response>> = isDemo
  ? Promise.resolve(initValDemoServer().valApiHandler)
  : Promise.all([import("@valbuild/tanstack/server"), import("prettier")]).then(
      ([{ initValServer, createPrettierFormatter }, prettier]) =>
        initValServer(
          valModules,
          { ...config },
          {
            formatter: createPrettierFormatter(prettier.default, {
              projectRoot: process.cwd(),
            }),
          },
        ).valApiHandler,
    );

export async function valApiHandler(req: Request): Promise<Response> {
  return (await handler)(req);
}
