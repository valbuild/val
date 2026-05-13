import { createRequire } from "node:module";
import type * as ts from "typescript";

// Load TypeScript via Node's createRequire so bundlers (webpack, Turbopack,
// esbuild, rollup) cannot statically follow the import. This avoids them
// tracing into typescript's lib/typescript.js, which contains a soft
// require("source-map-support") that emits noisy "Module not found" warnings
// in consumer Next.js builds.
const tsLib = createRequire(import.meta.url)("typescript") as typeof ts;

export default tsLib;
