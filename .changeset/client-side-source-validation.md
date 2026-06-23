---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/next": patch
---

Client-side schema and source validation: the editor now owns sources locally and only downloads from the server when newer; validation runs client-side in a web worker.
