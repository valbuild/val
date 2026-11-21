---
"@valbuild/core": patch
"@valbuild/react": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/tanstack-build": patch
---

Experimental: link an object to the component that renders it, and let Val render and arrange it

`s.object(...).component(() => import("./Hero"))` links an object schema to a component. The link is type checked against the component's own props: when the object's fields are the props nothing else is needed, and for any other component a `props` function says how to make them.

```ts
export const heroFields = s.object({
  type: s.literal("hero"),
  title: s.string(),
});
export const hero = heroFields.component(() => import("../components/Hero"));

export const note = s
  .object({ type: s.literal("note"), title: s.string(), urgent: s.boolean() })
  .component(() => import("../components/Callout"), {
    props: (note) => ({
      heading: note.title,
      tone: note.urgent ? "warning" : "info",
    }),
  });
```

`<ValComponentEditor value={page.sections} />`, from `@valbuild/tanstack` and `@valbuild/next`, renders a list of linked objects (or a single one) with their components, with no map from a `type` to a component to keep. It only accepts values that are linked: a list with a variant that has no component is a type error. It is optional, and a component can use it for a list of components of its own.

In Val Studio, a list rendered this way can be arranged on the page itself: drag a section to another place, add one between two others, or remove one.

This replaces the experimental `.render({ as: "component", component })` on objects. Move its `component` to the first argument of `.component()` and the rest of its options to the second.
