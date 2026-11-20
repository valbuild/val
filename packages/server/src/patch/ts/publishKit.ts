import ts from "typescript";
import { result, pipe } from "@valbuild/core/fp";
import { TSOps, insertValJsonEntry, removeValJsonEntry } from "./ops";
import { analyzeValModule } from "./valModule";
import {
  analyzeJsonValuesEntries,
  evaluateModuleSource,
  jsonValuesRecordKeys,
} from "./jsonValuesModule";
import { getJsonEntryAtCommit } from "../../history/getJsonEntryAtCommit";

/**
 * Everything Val's server needs from the TypeScript compiler, in one module:
 * what a publish needs (`ValOps.prepare`) and what the history reader needs
 * (`/history/json`, which reads a `.val.ts` at a commit to find an entry's
 * file).
 *
 * The compiler is 10.8 MB of source -- 84% of Val's server as a Worker
 * bundles it -- and a server in a browser tab or a memory-mode Worker never
 * publishes from it. So it is not imported by the request handlers at all,
 * not even dynamically: a bundler that does not split chunks (wrangler,
 * esbuild with one output file) inlines a dynamic `import()` and ships the
 * compiler anyway. It reaches the server through `ValServerPlatform`'s
 * `typescript` (the platform) and `ValOpsOptions.typescript` (the data layer),
 * both of which `nodePlatform` fills with `loadTypeScriptKit`, and the browser
 * platform leaves empty. `noNodeFromBrowser.test.ts` fails, naming the chain,
 * if TypeScript becomes reachable from `@valbuild/server/browser` again.
 */

const tsOps = new TSOps((document) => {
  return pipe(
    analyzeValModule(document),
    result.map(({ source }) => source),
  );
});

/** A `.val.ts` file's text, parsed. */
function parseValFile(text: string): ts.SourceFile {
  return ts.createSourceFile("<val>", text, ts.ScriptTarget.ES2015);
}

export {
  tsOps,
  parseValFile,
  analyzeValModule,
  evaluateModuleSource,
  analyzeJsonValuesEntries,
  jsonValuesRecordKeys,
  insertValJsonEntry,
  removeValJsonEntry,
  getJsonEntryAtCommit,
};
