---
"@valbuild/server": minor
---

Val's server in the browser (`@valbuild/server/browser`, which the demo
runs) no longer carries the TypeScript compiler. Bundled into a single file,
as a Cloudflare Worker is, it goes from 12.9 MB to 2.0 MB (2.1 MB to 0.4 MB
gzipped). An app that splits its bundle into chunks, as Vite does, no longer
builds a 3.5 MB chunk that the demo never loaded.

Nothing changes for a server started with `createValServer`: it still
publishes and reads history as before.

If you construct `ValOpsMemory` yourself and publish through it, pass
`typescript: loadTypeScriptKit` (exported from `@valbuild/server`). Without
it, a publish is refused with an error that says so, and nothing is lost:
the changes stay pending.
