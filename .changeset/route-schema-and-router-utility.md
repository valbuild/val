---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/server": minor
"@valbuild/cli": minor
"@valbuild/next": minor
"@valbuild/ui": minor
---

Add route schema and router utility function

This release introduces two new schema types to improve route handling in Val:

- **Route Schema (`s.route()`)**: A new schema type for representing route paths as strings. Routes can be constrained using `include` and `exclude` patterns with regular expressions, and are automatically validated against router modules.

- **Router Utility (`s.router()`)**: A convenient shorthand function that combines `s.record()` and `.router()` into a single call, making it easier to create router records.

**New Features:**

- `s.route()` schema with `include()` and `exclude()` pattern methods
- `s.router(router, schema)` utility function as shorthand for `s.record(schema).router(router)`
- Automatic route validation in both CLI and server
- UI support for route selection with filtered dropdown
- Shared route validation utilities in `@valbuild/shared/internal`
- Server-side handling of `router:check-route` validation fix
- Global error handling for schema endpoint failures in UI

**Breaking Changes:**

None. These are additive features that don't affect existing functionality.
