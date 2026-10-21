---
"@valbuild/tanstack-build": patch
---

A project's dependency layer no longer builds Val's server entry points for the browser. `@valbuild/tanstack/server` and `@valbuild/tanstack/demo` go in the worker half only, so the browser half stops carrying code nothing in the browser imports. `@valbuild/tanstack/demo` is about 15 MB: on the Val demo the browser half went from 20.2 to 4.8 million characters, and the whole layer from 40.8 to 25.4. Importing either from client code is still reported by name, as for any server-only dependency.
