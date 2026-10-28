---
"@valbuild/eslint-plugin": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The design tab's assistant can check its work two more ways.

- **`lint`** runs Val's own eslint rules -- the ones `@valbuild/eslint-plugin` runs in an editor -- over the proposal's files: a `c.define` path that is not the file's own, a module missing from `val.modules.ts`, `c.define` content that is a variable (which validates, then fails at publish), an import a `.val` file may not make. With `fix: true` it stages the fixes the rules can make themselves.
- **`screenshot_page`** shows the assistant a picture of the page in the preview, at desktop, tablet or phone width, on screen or the whole page. The page draws itself, through the canvas bridge in `@valbuild/next` and `@valbuild/tanstack`, so a site needs those packages at this version for it. The picture is drawn from the page's HTML and CSS: images from other sites, videos, canvases and embeds may come out blank.

`@valbuild/eslint-plugin` has a new entry, `@valbuild/eslint-plugin/rules`, with the same rules over a project that is not on a disk (`createRules(host)`). The plugin itself behaves as before.
