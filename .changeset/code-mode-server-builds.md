---
"@valbuild/ui": patch
---

**Code mode builds on Val Build, and shows a change in seconds before it is
built.**

- **Builds:** a proposal is now built by Val Build, whether Save, the
  preview's Try again or the assistant starts it. No bundler is loaded in the
  Studio and no builder tab is opened, on an iPhone as everywhere else. The
  Studio builds in the tab only for a project Val Build does not build.
- **Quick preview:** a second after code is staged in a proposal, the
  Studio's preview shows the change as a quick preview: its components,
  layout, styles and text, in seconds, without a build. What runs on the
  server stays the last build's until the proposal is built. Code mode's
  status says "Quick preview" while it is shown, and the preview goes back to
  the served build when a new one is ready.
- **The assistant** shows a change now with `quick_preview`, and builds
  only when a quick preview cannot show the change (server code, routes, a
  schema, a dependency) or when the change is complete.
