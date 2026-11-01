# Results

Each table says when, on what machine and from which command, so it can be
re-run rather than believed. Times are medians unless said otherwise. See
[README.md](README.md) for what each number is a floor or a ceiling of.

## One write in the Studio, by module size

2026-11-01, Claude Code cloud container (Linux, Node 22),
`node --import tsx measure/keystroke.ts`. 40 writes per size.

| Module   | Median   | p90      |
| -------- | -------- | -------- |
| 9 KB     | 0.41 ms  | 0.83 ms  |
| 91 KB    | 1.18 ms  | 2.32 ms  |
| 471 KB   | 6.84 ms  | 13.93 ms |
| 971 KB   | 17.63 ms | 22.88 ms |
| 1,978 KB | 43.12 ms | 50.74 ms |
| 5,026 KB | 113 ms   | 165 ms   |

Linear in the module's size, about 18-22 ms per MB: `SourceStore` clones the
whole module for every patch (`applyPatch(deepClone(module))`). A field writes
once per pause in typing, so this is paid per pause. In a module above about
2 MB it becomes noticeable. This is the cost the plan's copy-on-write engine
(phase 2) is for.

## Evaluating val.modules from source

2026-11-01, same container,
`node --import tsx measure/evaluateValModules.ts <root>`. Native rolldown, so
a floor for the browser.

| Project                   | Modules | Content | Bundle | Bundle (cold / warm) | Evaluate and read (cold / warm) |
| ------------------------- | ------- | ------- | ------ | -------------------- | ------------------------------- |
| templates `tanstack/full` | 9       | 7 KB    | 26 KB  | 34 / 30 ms           | 15 / 11 ms                      |
| valbuild/web              | 20      | 233 KB  | 330 KB | 169 / 99 ms          | 181 / 77 ms                     |

So for a real site, evaluating after every write costs about 0.2-0.35 s in
Node. It runs in the background after a write. The browser's WebAssembly
bundler will be slower, and has not been measured.

## A draft read on Val's server

Pending: `node --import tsx measure/draftRead.ts all` is running and this
table will be filled from it. Earlier spot numbers were dropped: the
synthetic rich text was declared with options it did not allow, so every
entry also reported validation errors, which inflated the times.
