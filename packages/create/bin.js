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
const { isUnsupportedNodeVersion } = require("./nodeVersion");

// ES2015 only in this file, deliberately: it has to PARSE on the old Node it
// exists to diagnose. Optional chaining (`engines?.node`) is ES2020, so on
// Node 13 and earlier it would turn the explanation into a syntax error. The
// `engines &&` guard does the same job - a package.json that ever loses
// `engines` skips the check instead of crashing on its way to explaining a
// crash.
const engines = require("./package.json").engines;
const required = engines && engines.node;
const current = process.versions.node;

if (required && isUnsupportedNodeVersion(current, required)) {
  console.error(
    [
      "",
      // The range itself, not a paraphrase of it: `^22.13.0 || >=23.5.0` is
      // NOT "22.13.0 or newer" - it excludes 23.0 to 23.4 - and a sentence
      // that says otherwise sends someone to install a Node this still
      // refuses.
      `Val needs Node ${required}, but this is Node ${current}.`,
      "",
      "Upgrade Node, then run the same command again:",
      "",
      "  nvm install --lts && nvm use --lts   # or fnm, volta, asdf",
      "  https://nodejs.org/en/download       # or an installer",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

require("./dist/valbuild-create.cjs.prod.js");
