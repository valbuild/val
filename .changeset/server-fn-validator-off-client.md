---
"@valbuild/tanstack-build": patch
---

A server function's validator no longer ships to the browser. TanStack Start removes `createServerFn().validator(...)` and `.inputValidator(...)` from client code, because a validator only ever runs on the server; the Val build replaced the handler but left the validator in, so its code — and anything it imported — reached every visitor's bundle. Both spellings are handled: TanStack Start 1.169 removed `.inputValidator()`, and 1.168 has both.
