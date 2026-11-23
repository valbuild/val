---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Experimental: a Components view in Val Studio

When a project links components to its content with `s.object(...).component(() => import(...))`, the Studio's rail gets a **Components** button. It opens `/val/components`, where you can:

- see every component side by side, rendered by your site on its `/val-preview` route, at phone, tablet or desktop width, in the preview's place, with Content and the Assistant opened from the top bar as beside a page;
- search the content of the components, and open the use a match is in;
- open one and step through every place the content uses it (← and →), or see all of them side by side, and its `example`;
- edit the fields of the use on screen in the Content pane beside it, or click content in the preview to jump to its field;
- ask the assistant to change the component: it is told which component it is, where it is linked and every place it is used.

What is on screen is in the address, so a component, a use of it and a screen width can be shared as a link.

`.component(load, { name: "Hero" })` names a component in the Studio. Without a name it is called after its object's literal field (`type: s.literal("hero")` is "Hero"), or the field it is used in.
