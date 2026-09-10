#!/usr/bin/env node
"use strict";

/**
 * Check Node BEFORE loading the bundle, because loading it is what fails.
 *
 * The bundle is CommonJS and `degit`, `chalk` and `@inquirer/prompts` are all
 * ESM-only, so requiring it needs Node's `require(esm)`. On an older Node the
 * first line throws ERR_REQUIRE_ESM and prints a stack trace pointing at a
 * file inside a package manager's dlx cache, which tells someone running
 * `npm create @valbuild` nothing about what to do.
 *
 * `engines` does not prevent this: npm only warns (EBADENGINE), pnpm enforces
 * it only with `engine-strict`, and neither is visible in the output of
 * `pnpm create`. So the check has to be here, and it cannot use chalk to say
 * so.
 */
const {
  isUnsupportedNodeVersion,
  minimumNodeVersion,
} = require("./nodeVersion");

// Optional chaining, so a package.json that ever loses `engines` makes the
// check skip rather than crash on its way to explaining a crash.
const required = require("./package.json").engines?.node;
const current = process.versions.node;

if (required && isUnsupportedNodeVersion(current, required)) {
  const minimum = minimumNodeVersion(required);
  console.error(
    [
      "",
      `Val needs Node ${minimum ? `${minimum} or newer` : required}, but this is Node ${current}.`,
      "",
      "Upgrade Node, then run the same command again:",
      "",
      "  nvm install 24 && nvm use 24     # or fnm, volta, asdf",
      "  https://nodejs.org/en/download   # or an installer",
      "",
      `Supported: ${required}`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

require("./dist/valbuild-create.cjs.prod.js");
