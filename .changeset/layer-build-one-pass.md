---
"@valbuild/tanstack-build": patch
---

Building a project's dependency layer takes one build per target again, instead
of falling back to building every dependency on its own. A dependency that
reaches a Node builtin from the browser side (`@valbuild/tanstack/server`,
`@valbuild/mcp`, `sharp`) or loads a native binary (`@tailwindcss/vite`) used
to fail the first build, and finding out which one did took two builds per
dependency. Now the first build finds them, and the layer is the same as
before.

The import check after each build also reads only a chunk's import
statements, found with `es-module-lexer`, instead of parsing the whole chunk:
Val's server chunk is 20 MB.

On the `template-tanstack` projects the two together took a layer build from
about 45 s and 2.8 GB to 8–12 s and 1.1–1.25 GB. Each server-only or skipped dependency is
now reported with the builtin or binary it reached and the module that asked
for it.
