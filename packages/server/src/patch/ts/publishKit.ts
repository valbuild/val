import ts from "typescript";
import { result, pipe } from "@valbuild/core/fp";
import { TSOps, insertValJsonEntry, removeValJsonEntry } from "./ops";
import { analyzeValModule } from "./valModule";
import { evaluateExpression } from "./syntax";
import {
  analyzeJsonValuesEntries,
  jsonValuesRecordKeys,
} from "./jsonValuesModule";

/**
 * Everything `ValOps.prepare` needs from the TypeScript compiler, in one module
 * so that it is loaded when a publish asks for it rather than with the server.
 *
 * The compiler is most of the server's weight in a browser: the demo's in-tab
 * server was a 3.6 MB chunk, nearly all of it this, and the demo never
 * publishes. `prepare` imports this module dynamically, which a bundler turns
 * into a chunk of its own; `noNodeFromBrowser.test.ts` fails if TypeScript
 * becomes statically reachable from `@valbuild/server/browser` again.
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
  evaluateExpression,
  analyzeJsonValuesEntries,
  jsonValuesRecordKeys,
  insertValJsonEntry,
  removeValJsonEntry,
};
