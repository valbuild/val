import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { require } from "tsx/cjs/api";
import core, { type SourcePath } from "@valbuild/core";
const filePath = path.resolve(
  "/home/freekh/Code/valbuild/val/examples/next",
  "./components/clientContent.val.ts"
);

function evaluateModule(filePath: string) {
  delete require.cache[filePath];
  const loaded = require(filePath, import.meta.url);
  console.log(
    core.Internal.getSchema(loaded.default)?.validate("/test" as SourcePath, {
      test: "hei",
    })
  );
}

fs.watch(filePath, () => {
  // Re-evaluate when the file changes
  evaluateModule(filePath);
});
