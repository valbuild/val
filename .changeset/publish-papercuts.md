---
"@valbuild/cli": patch
"@valbuild/tanstack-build": patch
---

`val publish` fixes, from moving a real TanStack Start site onto Val:

- **`--help` prints help and runs nothing.** `val publish --help` (and
  `validate --fix --help`, `delete-unappliable-patches --yes --help`, …) used to
  run the command. Every command now has its own help, with `--help` or `-h`.
- **`@config` / `@plugin` with a relative path works.** `@config "../tailwind.config.js"`
  in `src/styles.css` is resolved from the stylesheet, as under Vite. When it
  cannot be resolved, the error says whether the file does not exist or the
  package is not installed.
- **No warning for TanStack Start's `tanstack-start-manifest:v`.** It is
  left external on purpose, and the publish no longer prints an
  `UNRESOLVED_IMPORT` for it.
- **Build tools in `dependencies` are left out of the dependency layer.** A
  Vite plugin, `vite` or `tailwindcss` that nothing imports is no longer
  bundled, and the publish says to move it to `devDependencies`. So does the
  warning for any dependency nothing imports that cannot be bundled.
