---
"@valbuild/create": patch
---

`npm create @valbuild` now says when your Node is too old, instead of throwing `ERR_REQUIRE_ESM`

On Node 20 the command failed with a stack trace ending in

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../degit/dist/index.js
from .../@valbuild/create/dist/valbuild-create.cjs.prod.js not supported.
```

which names a file inside a package manager's dlx cache and says nothing about
what to do. The package has always needed Node `^22.13.0 || >=23.5.0` — its
dependencies are ESM-only, so loading it needs Node's `require(esm)` — but
`engines` never stopped anyone: npm only warns, pnpm enforces it with
`engine-strict`, and neither warning shows up in `npm create` / `pnpm create`
output.

The version is now checked before anything is loaded:

```
Val needs Node ^22.13.0 || >=23.5.0, but this is Node 20.11.0.

Upgrade Node, then run the same command again:

  nvm install --lts && nvm use --lts   # or fnm, volta, asdf
  https://nodejs.org/en/download       # or an installer
```

The range is read from `engines.node` and printed as it is written, rather
than paraphrased: `^22.13.0 || >=23.5.0` is not "22.13.0 or newer" — it
excludes 23.0 to 23.4 — and a message that rounded it off would send you to
install a Node that still gets refused. A version or range the check cannot
parse is allowed through, so it can only ever explain a failure that was going
to happen anyway.

The README also now notes that PowerShell needs the package name quoted:
`npm create "@valbuild@latest"`. Unquoted, PowerShell reads `@valbuild` as
splatting and drops the argument, so the command fails with
`ERR_PNPM_MISSING_ARGS  Missing the template package name` before npm or pnpm
sees a name at all.
