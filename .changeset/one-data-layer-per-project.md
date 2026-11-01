---
"@valbuild/server": patch
"@valbuild/mcp": patch
---

The Val servers an app runs in one process (the API route, the readers that
render draft content on the server, and MCP) now share one copy of the
project's content. Before, each kept its own, and a publish moved only the
copy of the server that handled it: in a host that keeps its source in memory,
a draft page read through `fetchValKey` or `fetchValRoute` went on showing the
content from before the publish. If two of those servers are given different
options for the same `val.modules` (a different patch store, say), they keep
separate copies as before, and Val now logs a warning saying which options
differ.
