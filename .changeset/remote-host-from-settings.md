---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/mcp": patch
---

Remote files are now addressed on the host the project's settings name. For a
project hosted by Val, that is the project's own address, and its remote images
and files are served from there rather than from `remote.val.build`. Every other
project is unchanged.

- The Studio, `val validate --fix` and the MCP image tool all take the host from
  the project's settings, falling back to `remote.val.build` as before.
- Re-reading a remote file whose recorded size or type is out of date keeps it
  on the host it was on.
- When a remote file's host cannot be reached, tooling downloads it from the
  project's permanent `<id>.valstart.dev` address instead, and keeps it only if
  its bytes match the file the address names.
