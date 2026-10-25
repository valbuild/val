---
"@valbuild/ui": patch
"@valbuild/server": patch
---

An upgrade renders its new build on the platform before it can be published. Once the typecheck finds no new errors and the build is done, the upgrade tab asks Val Build to render that build, as a publish does before it goes live. Publish is offered only when it renders. An upgrade can move the framework and React a site runs on, which a typecheck cannot judge and a render can.
