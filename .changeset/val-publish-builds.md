---
"@valbuild/cli": minor
---

`val publish` builds the site itself.

Run in a project with no `--artifacts`, it now asks Val what to build against, builds the site and its dependency layer from the checkout, and publishes the result. A CI workflow is one step:

```yaml
- run: npx val publish
  env:
    VAL_PROJECT_TOKEN: ${{ secrets.VAL_PROJECT_TOKEN }}
```

The build needs these installed in the project, as devDependencies:

```bash
npm install --save-dev @valbuild/tanstack-build rolldown @tanstack/router-generator @tanstack/router-plugin
```

A dependency layer Val already holds is named, not uploaded again. The checkout is left as it was found: the route tree is generated and put back, and the build is written to a temporary directory.

To publish a build made elsewhere, pass `--artifacts <dir>` as before. A project that already has a `.val/publish` directory still publishes that directory without building.
