---
"@valbuild/ui": patch
"@valbuild/server": patch
---

In a proposal on a hosted project, the Studio's assistant can now change the project's code, not only its content:

- `list_files` and `read_file` read the project's code. In a proposal they read the proposal's version of it.
- `write_files` stages whole files in the proposal, or deletes them.
- `build_proposal` builds those files in the tab, so the proposal's preview shows them. Nothing is published: the site changes only when the proposal is published.

The top bar shows **Build required** while staged code is not in the preview yet, and the same button builds it. A failed build says why on the button, and pressing it again builds again.

On the site itself, code is never changed directly. A code change asked for there is refused, and New proposal opens so the change can be made in one.
