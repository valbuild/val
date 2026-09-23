/**
 * Building a TanStack Start app from a Val project's files.
 *
 * Three things that used to be three packages in valbuild/home -- the browser
 * builder, the wiring that turns an imported checkout into something a host can
 * serve, and the types the two sides of the wire agree on. They are one package
 * because they are one decision: what a published build IS.
 *
 * ## Why here, and not there
 *
 * The builder had already been severed from the platform's vendor package --
 * it takes a {@link BuildTarget} as a parameter rather than importing the
 * platform's externals at compile time -- and severing it was what made it
 * movable at all. What forced the move was the WIRING: it writes code against
 * `initValServer`'s signature, and it lived in another repository on another
 * release train, so a signature change here could not break it until someone
 * published. Now it is beside the function it calls.
 *
 * ## Two entrypoints, and the line between them
 *
 * This one runs anywhere: a browser tab, a Worker, Node. The `/node`
 * entrypoint is the half that cannot -- it reads `node_modules` and shells out
 * to the native bundler to build a project's dependency layer. `@valbuild/ui`
 * imports THIS one and must never reach the other; `noNodeFromBrowser.test.ts`
 * is what keeps that true.
 */
export * from "./build";
/*
 * Named rather than `export *`, because these modules also export things whose
 * names only make sense inside the build: `paths.ts` has a `resolve` and a
 * `dirname` of its own, and `tailwind.ts` has a `compileTailwind` the build
 * calls and nobody else should.
 */
export { aliasMap, type AliasMap } from "./tsconfigPaths";
export { resolveInFiles } from "./paths";
export { scanCandidates, usesTailwind } from "./tailwind";
export * from "./contract";
export * from "./artifacts";
export * from "./gitTree";
export * from "./wire";
