/**
 * The part of `@valbuild/shared/internal` that is safe to put in a browser
 * bundle.
 *
 * `@valbuild/shared/internal` is a single preconstruct entrypoint, so
 * preconstruct publishes it as ONE module: importing a string constant from it
 * pulls in everything else, and everything else includes `ApiRoutes.ts`, whose
 * zod schemas cost ~113 KB minified. `@valbuild/next`'s client code needs five
 * things from that entrypoint, three of which are string constants, so every
 * production visitor to a Val site was paying for zod to read
 * `VAL_THEME_SESSION_STORAGE_KEY`.
 *
 * Nothing re-exported here may import zod, directly or transitively. The
 * `noZodInClientEntrypoint.test.ts` beside this file is what enforces that -
 * a single new re-export can silently put 113 KB back.
 */
export * from "../internal/sessionStorage";
export * from "../internal/valCanvasProtocol";
export * from "../internal/parseRoutePattern";
export * from "../internal/getNextAppRouterSourceFolder";
export * from "../internal/getSitemapTree";
