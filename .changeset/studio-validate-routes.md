---
"@valbuild/server": patch
"@valbuild/shared": patch
---

Two new Studio API routes for the full content check, not yet used by the
Studio's UI:

- `POST /api/val/validate` checks one module — its content against its schema,
  and its local images and files against their bytes — on the content the
  Studio is showing.
- `POST /api/val/validate/fix` returns the patch that fixes one of those errors,
  for the Studio to add as a pending change. It builds only the fixes that need
  no disk or remote host: image, file and video metadata, and a view pointing at
  the wrong module.

Also fixed: an API route whose name started with another route's name could be
answered by the other route.
