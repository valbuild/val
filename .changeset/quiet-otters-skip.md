---
"@valbuild/ui": patch
---

Avoid spurious 500s in fs mode without a configured project: the studio no longer requests `/profiles` when running in fs mode with no project, and the AI session restore on mount only fires when AI chat is enabled.
