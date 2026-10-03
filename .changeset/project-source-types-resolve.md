---
"@valbuild/tanstack-build": patch
---

The `src/val/project-source.d.ts` that wiring a project up to the platform writes now actually declares `platform:project-source`. It was a module (it ended in `export {}`), which made its `declare module` an augmentation of a module that does not exist, so `import { FILES } from "platform:project-source"` in the generated `val.server.ts` failed to resolve in an editor and in `tsc`. Re-wiring a project rewrites the file.
