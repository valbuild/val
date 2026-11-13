---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/cli": patch
"@valbuild/language-server": patch
---

`VAL_PROJECT` now wins over `project` in `val.config`, everywhere Val reads it. A deployment can point a site at another Val Build project, such as a self-hosted installation or a staging host, without editing the config file every other deployment shares. Before, the server and the Studio preferred the config while `val validate` preferred the environment, so one setting could mean two different projects.
