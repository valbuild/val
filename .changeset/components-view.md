---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Experimental: a Components view in Val Studio

When a project links components to its content with `s.object(...).component(() => import(...))`, the Studio's rail gets a **Components** button. It opens `/val/components`, where you can:

- see every component side by side, rendered by your site on its `/val-preview` route, at phone, tablet or desktop width, in the preview's place, with Content and the Assistant opened from the top bar as beside a page;
- search the content of the components, and open the use a match is in;
- open **Pages** to see the components a page is made of, stacked in the order its content has them, with a list of components inside another nested under it;
- pick content with the same **Select** as beside a page's preview, and with **Select & edit** type straight into a component's preview;
- switch the Preview pane between **Page** and **Components** from the Preview button's menu;
- jump to a component from the page (**Open in Components** in the controls over it) or from its fields (the **Show in Components** icon);
- see the assistant's code changes in the previews as soon as code mode's quick preview has them;
- open one and step through every place the content uses it (← and →), or see all of them side by side next to its examples;
- edit the fields of the use on screen in the Content pane beside it, or click content in the preview to jump to its field;
- ask the assistant to change the component: it is told which component it is, where it is linked and every place it is used.

What is on screen is in the address, so a component, a use of it and a screen width can be shared as a link.

`.component(load, { name: "Hero" })` names a component in the Studio. Without a name it is called after its object's literal field (`type: s.literal("hero")` is "Hero"), or the field it is used in.

`.component(load, { examples })` takes a record of named examples, as stories are, rather than one `example`: `examples: { longTitle: {...}, empty: {...} }`. The Studio shows them as "Long title" and "Empty". The preview route takes one by name: `/val-preview?p=…&example=longTitle`.
