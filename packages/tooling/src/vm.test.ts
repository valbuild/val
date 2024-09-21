import * as vm from "node:vm";
import { createRequire } from "module";
require("sucrase/register/ts");
// Function to create a custom require for a specific directory
function createRequireForDirectory(directory: string): NodeRequire {
  return createRequire(directory + "/dummy.js");
}

// The directory where you want 'require' to resolve modules from
const customDirectory: string = "/home/freekh/Code/valbuild/val/examples/next";

// Create a custom require that resolves from the specific directory
const customRequire: NodeRequire = createRequireForDirectory(customDirectory);

describe("testing vm", () => {
  test("test", async () => {
    console.log(customRequire.resolve("./val.modules"));
    vm.runInNewContext(
      `const c = require('./val.modules')
      console.log(c)
      `,
      { console, require: customRequire },
      {},
    );
  });
});
