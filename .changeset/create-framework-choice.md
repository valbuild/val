---
"@valbuild/create": minor
---

`npm create @valbuild` now asks which framework you want

TanStack Start joins Next.js as a starter, and choosing between them is the
first question — before the project name, because everything after it depends
on the answer.

```sh
pnpm create @valbuild@latest my-app --tanstack
pnpm create @valbuild@latest my-app --framework tanstack   # same thing
pnpm create @valbuild@latest my-app --nextjs
```

Like every other question here, a flag answers it and the prompt is skipped, so
a scripted setup never blocks. `--framework` also takes `next`, `next.js` and
`tanstack-start`, and the last flag wins if you pass more than one. A framework
we do not have a starter for is an error naming the ones we do, rather than a
silent fall back to Next.js.

The feature questions now follow the starter. The TanStack Start starter does
not ship an MCP endpoint yet, so it is not asked about there — and a `--mcp` or
`--image-uploads` flag given anyway is turned off with a note, rather than
producing a project whose success message points a coding agent at an endpoint
that is not in it.
