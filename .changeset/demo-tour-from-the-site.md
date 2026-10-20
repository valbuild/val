---
"@valbuild/tanstack": patch
"@valbuild/ui": patch
"@valbuild/shared": patch
---

A demo's tour can now be written by the site: `<ValApp demo={{ tour }}>`, with each step as data (`ValDemoTourStep`), so what it says changes with the site rather than with a Val release.

It is drawn as a ring around what a step is about, with nothing dimmed and the Studio usable underneath, and a step can move on by itself once the visitor has done what it asks:

```ts
const tour: ValDemoTourStep[] = [
  {
    id: "click",
    title: "This is Val",
    body: "Click the heading on the page.",
    target: "canvas",
    page: HEADING, // outlined on the page
    moveOn: { open: HEADING },
  },
  {
    id: "type",
    title: "Change a word",
    body: "The page changes as you type.",
    field: HEADING, // ringed wherever the field is shown
    moveOn: {
      edit: true,
      path: HEADING,
      value: "Coffee, roasted this weekend",
    },
  },
];
```

A step that moves on has **Do it for me**, which does it the way the Studio would, and **Skip**. On a phone the card is a sheet along the bottom. The Studio's own tour is unchanged.
