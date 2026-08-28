---
"@valbuild/server": patch
"@valbuild/init": patch
"@valbuild/create": patch
---

Raise dependency floors past known advisories

The dependency ranges that ship with these packages now start at the first
release carrying the fix for an advisory that applied to the version we were
resolving:

- `@valbuild/server`: `minimatch` `^10.1.1` -> `^10.2.3`, for three ReDoS
  advisories in `matchOne()` and in extglob handling, and to pick up the
  patched `@isaacs/brace-expansion`.
- `@valbuild/init`: `express` `^4.18.2` -> `^4.22.2`, which brings the patched
  `path-to-regexp`, `qs` and `body-parser`; `simple-git` `^3.22.0` -> `^3.36.0`,
  for two command-execution advisories and a `blockUnsafeOperationsPlugin`
  bypass that allowed remote code execution.
- `@valbuild/create`: `degit` `^2.8.4` -> `^2.8.6`, for a command injection
  advisory.

Every bump stays inside the major the package already depended on, so nothing
changes for consumers beyond the resolved version.

One advisory is knowingly left open: `image-size` has no patched release for
the infinite loops in its ICNS, JXL and HEIF parsers, and 2.0.2 is the latest
version published. There is nothing to move to yet.
