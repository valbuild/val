// Refuses to publish a `preconstruct dev` tree.
//
// `dist/` is gitignored, and `preconstruct dev` replaces each entrypoint with a
// SHIM that requires the source through a Babel hook, by a path inside this
// checkout's node_modules. Published, that shim is a package that cannot work
// anywhere: it re-exports `../src/index.ts`, which `files` does not ship.
//
// This is not hypothetical. 0.0.1-alpha.0 went to npm exactly that way -- 4 kB
// where the build is 281 kB -- and npm versions are immutable, so the number
// was spent rather than fixed. CI never hits it (`pnpm run release` builds
// first); a hand publish of a NEW package is the exposed path, and this package
// was hand-published by design.
//
// `prepublishOnly` rather than `prepack`, deliberately: `pnpm pack` is how you
// inspect a build, and failing that would be in the way. This fires only on the
// thing that cannot be undone.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENTRIES = [
  "dist/valbuild-tanstack-build.cjs.js",
  "node/dist/valbuild-tanstack-build-node.cjs.js",
];

let bad = false;
for (const entry of ENTRIES) {
  const file = path.join(root, entry);
  let code;
  try {
    code = await readFile(file, "utf8");
  } catch {
    console.error(`✘ ${entry} does not exist.`);
    bad = true;
    continue;
  }
  if (
    code.includes("@preconstruct/hook") ||
    /require\("\.\.\/+src\//.test(code)
  ) {
    console.error(`✘ ${entry} is a \`preconstruct dev\` shim, not a build.`);
    bad = true;
  }
}

if (bad) {
  console.error(
    "\nRun `pnpm run build` from the repository root before publishing, then\n" +
      "`pnpm preconstruct dev` afterwards to restore the dev links.\n",
  );
  process.exit(1);
}
console.log("dist looks built.");
