# Render and preview

Two schema methods decide how content looks in the Studio, and they answer
different questions. Conflating them is the mistake this note exists to
prevent — it has already been undone once, when the two shared a pipeline.

## The rule

- **`render` is how a field is laid out, and applies only when you are looking
  at the field.** `.render({ as: "inline" })` on an ARRAY or RECORD edits each
  of its items inside its (sortable) list row instead of behind a clickable
  row. The list decides; the item has no say. That is the whole of what a
  render says — see "What a render is not" below. (`s.keyOf(...)` also takes
  one, meaning something of its own: see "Where it is declared"; and so do
  `s.int()` / `s.number()`, as a slider: see "A slider is a render".)
- **`preview` is how the VALUE is shown wherever a preview of it is needed** —
  a list row you click through to, a reference (`keyOf`) dropdown, a search
  hit, the references view. A preview is needed exactly where the value is
  NAVIGABLE to rather than open. It is never how the field itself is edited —
  and where the two meet, on a row that is inline, the render wins (below).

So the two never intersect: a schema can carry both, `render` is read where
the field is drawn, `preview` where the value is previewed. Declaring another
`.render(...)` on the same schema REPLACES the earlier one (last wins), and a
second `.preview(...)` replaces the earlier preview the same way — they do not
merge.

## What a render is not

A render used to be the answer to "how is a string edited" as well: there were
`{ as: "textarea" }` and `{ as: "code", language }` variants on `s.string()`
alongside `inline`. Both are gone.

```ts
s.string().multiline(); // was .render({ as: "textarea" })
s.code({ language: "typescript" }); // was .render({ as: "code", language })
```

The reason is that neither was about layout. Whether a string may hold line
breaks is a fact about the content, and it belongs to the schema: it is
`.multiline()`, a property the serialized schema carries next to `render`
(`SerializedStringSchema.multiline`) and read the same synchronous way where the
field is drawn. Code is a step further — it is its own schema type, `s.code()`,
because a language is not a way of drawing a string but part of what the value
is, and being a type is what lets it opt out of stega encoding: invisible
characters woven into source code are corruption, not an edit tag
(`stegaEncode`'s `isCodeSchema`).

What is left is one question — does this list edit its items in their rows —
which is why `FieldRender` is a single variant and `isInlineRender` can answer
it from the serialized schema alone. A render that could also mean "textarea" was a
union whose only common trait was that it lived in the same field.

## A slider is a render

`s.int().render({ as: "slider", min: 0, max: 100 })` is the one render a leaf
takes, and it passes the test the textarea failed: a slider and a text box hold
exactly the same values. Nothing about what the content IS changes; only the
input in front of it does. That is layout, so it is a render — its own type,
`NumberRender`, beside the containers' `FieldRender` rather than inside it, so
`isInlineRender` stays a question about lists.

Its `min` and `max` are REQUIRED, because a slider without ends is not a
slider, and they are the slider's, not rules. The rules are `.min()`, `.max()`
and `.step()` on the schema, and they are what the validator checks. The two
are tied by one constraint, checked where the schema is defined
(`assertNumberSchemaIsConsistent` in `number.ts`): **the slider may only
produce values the schema accepts** — its range inside the rules, its step a
multiple of the schema's, its `min` on the schema's grid, and whole numbers on
an int.

So a value outside the slider's range is valid content and NOT an error: the
field pins the thumb to the end, keeps the real value in the box beside it,
says it is out of the slider's reach and offers "Set to" the nearest stop. A
value that breaks a RULE is a validation error like any other, with a "Round
to" next to it. Both offer a value from `Internal.number.nearestAllowedNumber`,
the validator's own arithmetic, so the button never leads back to the error.

## A component is linked to an object (EXPERIMENTAL)

```ts
export const heroFields = s.object({
  type: s.literal("hero"),
  title: s.string(),
});
export const hero = heroFields.component(
  () => import("../components/HeroSection"),
  { example: { type: "hero", title: "A very long title" } },
);
```

The component that renders an object on the site. Two things use it: the
site, which renders the object with it (`ValComponentEditor`), and the Studio,
which shows it, rendered by the app in an iframe, next to the object's fields.

It was `.render({ as: "component", component })`, and is its own method
because it stopped being a render: a render is layout in the editor and
applies only while the field is open, and this decides what a visitor gets.
The wire form did not move - the marker is still the serialized `render`,
`{ as: "component", example?: true, maxWidth?, aspectRatio? }` - so the
Studio's side is unchanged.

It holds CLOSURES (the import thunk, and `props`), so it is plumbed like a
preview: only the marker travels, and the host app, which has the schema
instance, finds the component (`getComponentRender` in `core/src/render.ts`).
A discriminated union answers for the variant its value takes, so a list of
sections needs nothing on the list itself.

### The link is type checked, on the line that makes it

`.component(load, options)` infers the component's type from the `import()`
and reads its props off it structurally (`ComponentPropsOf`), with no React in
core. What follows the thunk is `ComponentArgs`: when what a READER gives back
for the object is assignable to those props, options are optional; when it is
not, options with a `props` function are required, and the function's result
is checked instead. That is what lets any component be linked, not only one
written for the schema.

"What a reader gives back" is why the read types (`StegaOfSource`, `Image`,
`ValEncodedString` and the rest) are defined in core, in `read.ts`:
`.component()` lives in core and has to be able to say them. An image has a
`url` only on the read side, so checking against the Source would refuse a
component that renders one. `@valbuild/react/stega` re-exports them all.

One trap, which the example above is shaped to avoid: a component that types
its props from the schema it is linked FROM (`t.inferSchema<typeof hero>`)
makes the schema's type depend on the component's and the component's on the
schema's, and TypeScript reports `'hero' implicitly has type 'any'`. Declare
the fields first and link them in a second `const`, or let the component own
its props.

`props` is called through `componentPropsOf`, in one place for the site and
for the Studio's preview, so the preview cannot show a component the site
renders differently. It holds the one assertion this needs: a render found by
path has lost its relation to the schema `.component()` checked it against.

### How the site finds the component: it rides on the value

`<ValComponentEditor value={page.sections} />` takes no map from a `type` to
a component. Each object says what renders it, because the reader attached
it: `stegaEncode` sets the object's `ComponentRender` on a symbol
(`setComponentOfValue` / `componentOfValue` in `core/src/render.ts`). The same
mechanism as a view's handle, and for the same reason - the app cannot get
from a value back to its schema, and the reader is the one place with both.

- **From the schema INSTANCE.** The walk is over the serialized schema, which
  has the marker and not the closure, so an object with the marker looks its
  component up from the root of what is being walked, by its own path
  (`componentRenderAt`). For a `.jsonValues()` entry read by key the root is
  the entry, which is why `getJsonEntryStegaRoot` hands over the item schema.
- **In production too.** Unlike an object's path, which is set only in draft
  mode: this is how the site renders.
- **Lazy.** Attaching a thunk loads nothing. A page downloads the components
  it shows, each the first time it is shown, through one `React.lazy` per
  thunk, kept (`lazyComponentOf`) - a new one per render is a new component
  type per render.
- **It does not survive serialization.** A value passed from a server
  component to a client one, or through loader data, arrives without it, and
  `ValComponentEditor` renders nothing for it and says so once.

### `ValComponentEditor` only takes what is linked

`.component()` returns a schema whose SOURCE type carries an optional slot
(`ValComponentSource`, the same shape as the slot on `ValViewSource`), and
`StegaOfSource` turns that into a required one on the read side: `ValComponent`.
The editor's `value` is `ValComponent | readonly ValComponent[] | null`. So a
list with one variant that was not linked, or an object that never was, fails
to compile where it is rendered - there is no runtime "no component for this
type" on a page that type checks. The slot is optional on the source so the
content in the `.val.ts` stays a plain literal.

It is not a page: it renders what it is handed and nothing around it. A page
can use it for one list and write the rest by hand, and a component can use
it for a list of components of its own, which is all nesting is.

### Arranging a list on the page

In the Studio's canvas a list rendered by `ValComponentEditor` can be
arranged where it is shown: drag an item, add one before or after another,
remove one. The controls are `ValComponentEditorChrome.tsx`, and exist only
when the document is the canvas frame AND the list has a path, which it has
in draft mode.

- **The page asks, the Studio writes.** The page has no patch store. It posts
  a `componentEdit` (`ValCanvasComponentEdit` in `valCanvasProtocol.ts`) and
  `useCanvasComponentEdits` writes the patch - the list field's own `move` /
  `remove` / `add` - which comes back as a `sourceUpdate` like any edit.
- **An addition does not say what.** The Studio has the schema, so a union
  becomes a dialog of its variants, each with its description, and a list of
  one schema is added to at once. The new item is then opened.
- **An item is its place.** The element around each component is marked
  (`data-val-component`) with no value, and an edit names indices. An item
  the page could not render still has its element, so the count is right.
- **A list answers for its own items only.** The pointer's NEAREST component
  decides, so a list inside a component of another list has its own controls.
- **The controls are not the page's content.** They may sit inside an element
  with a `data-val-path`, and the bridge's pick handler asks
  `isOnValCanvasControls` first.
- **No `react-dom`.** The layer is the list's last child, `position: fixed`
  and measured rather than assumed to be at the window's corner
  (`relativeTo`), instead of a portal: the file is reached from
  `val.config.ts` through the framework package's entry. For the same reason
  nothing in it may run at import time - a table of JSX elements there broke
  `val validate`, which evaluates the config with no React.

### Where the thunk must NOT be followed

Val modules are evaluated outside the app, and the thunk is never called
there. A bundler follows it anyway. `bundleValModules` in
`@valbuild/tanstack-build` therefore leaves a dynamic import from a `.val.ts`
external when it names app code (`isAppCodeImport`): bundled, the component
and everything it imports would be in the module the Studio evaluates, and
every Val module would depend on its components' files.

### The preview beside the fields

The app renders it on a route of its own that the Studio loads in a frame,
`/val-preview?p=<source path>` (hard-coded in `ComponentPreview.tsx` for
now). Finding the component and its props is shared,
`resolveValComponentPreview` in `@valbuild/react/internal`, and each binding
renders it its own way:

- **Next**: `unstable_renderValComponent` in a Server Component, which reads
  with the app's `fetchVal`; a refresh is `router.refresh()`.
- **TanStack**: the loader reads the module through a server function
  (`unstable_fetchValPreviewSource` from `@valbuild/tanstack/server`), and
  `Unstable_ValComponentPreview` finds and renders the component in the
  browser; a refresh is `router.invalidate()`. The route is `ssr: false` and
  outside `_site`: under the site's `ValProvider` the frame would be taken for
  the Studio's canvas (any frame inside the Studio is, see
  `isValCanvasFrame`), and the edit tags are only switched on in the browser.

Both wrap it in `ValPreviewBridge` (the shared `ValPreviewBridgeCore`, in its
own `"use client"` file so a Server Component can import the resolver).

`maxWidth` and `aspectRatio` are plain numbers, so unlike the component they
travel whole, and the Studio lays the frame out with them. `maxWidth` caps the
frame, which is the component's whole viewport, so it is also the width its
media queries see. Without `aspectRatio` the frame is as tall as the component:
the preview route wraps its output in `ValPreviewBridge`, which reports the
height whenever it changes (`VAL_PREVIEW_MESSAGES` in `render.ts`), because the
Studio cannot see into the frame to measure it.

In the Studio the field itself carries the switch: Preview, Content or Split,
starting from the render's `defaultView` (`"split"` when it has none).
`AnyField` wraps an object or union field that has a component in
`ComponentField` (`ComponentPreview.tsx`), so it works on the value being
navigated to and on an object field inside it alike, but not in an inline
row, which has no room for a frame. Split starts on a phone-wide frame, which
leaves the fields the most room; pressing Split again moves to an iPad and
then a desktop. A screen wider than the room is laid out at its own width and
scaled down, so the component's media queries see the screen, not the
column.

Clicking content in the preview opens its field, and is on by default (a
toggle on the field turns it off, so links and buttons in the component work
as on the site). It is the canvas's mechanism in a smaller frame: the preview
loads through `/api/val/enable`, so it renders draft content with stega,
`autoTagJSX` tags the elements with `data-val-path`, and `ValPreviewBridge`
turns a click on one into a `pick` message. The Studio switches to Split and
scrolls to the field and focuses its input - without navigating, which would
remount the field and start it over from its `defaultView`. A value that is
not a field of its own (an item of a list of strings) scrolls to the nearest
field above it and focuses nothing, rather than guessing an input.

`component` is a lazy `import()` and never the component. Val evaluates
`.val.ts` files outside of the app — `val validate` and the language server in
`node:vm`, the Studio in a rolldown Worker — and a component pulls in CSS,
images, `next/*` and `server-only`, none of which those can load. A thunk is
never called there, so the component's file is never loaded, and
`no-illegal-imports` (which checks only static imports) has nothing to say.

## Where they meet: a list row, and the render wins

A list row is the one place both have a claim, because a row is where a value
is normally shown rather than opened. The rule is that **`inline` wins
outright**:

```ts
s.array(s.object({ ... }).preview(previewFun)).render({ as: "inline" });
```

Looking at that array field, you see the object's own fields, laid out in the
row and editable there. You do NOT see `previewFun`'s card. The render is the
author saying "this is edited here", which settles what the field is; the
preview then describes the value everywhere it is only referred TO — a search
hit, a `keyOf` dropdown, the references view, a row in some OTHER list that
holds this value — and, inside its own row, the collapsible header that says
what the block is while its fields are folded away. That header is a summary of
the value, which is exactly a preview's job; it is not how the row is edited.

Nothing about the preview is wasted by inlining, in other words: it is still
the answer to "what is this value called", it is just no longer asked "how is
this value edited".

`ArrayFields` reads this off the array's own schema and picks the list: an
inline array gets `BlockList` (rows that are each an editor, collapsible, with
nested lists indented under their label) and everything else gets
`SortableList` (preview rows you click through to). `RecordFields` asks the
same question of the record and gets the same `BlockList`, so an inline array
and an inline record look and work alike: a record's rows are named by their
key where an array's are numbered, and have no drag handle, since a record has
no order. The number (or key) is the row's menu.

### The container declares it, never the item

`isInlineRender` (`core/src/render.ts`) is the one implementation of the
question, and it takes the CONTAINER: it is true for an array or record that
declares `.render({ as: "inline" })`, and false for anything else.

```ts
s.array(
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("text"), text: s.richtext() }),
    s.object({ type: s.literal("code"), code: s.string() }),
  ),
).render({ as: "inline" });
```

That is how a page-builder list is written. It used to be the other way round
— the render went on the ITEM — and three things were wrong with that, all of
them gone now:

- **A union had nowhere natural to put it.** The union is a dispatch, not
  something an author thinks of as the field, so the render went on the blocks,
  and `isInlineRender` had to look through the union and accept ANY variant's
  render. One block type declaring it decided the whole list.
- **An item could not be reused** in one list that wants forms and another
  that wants preview rows, since the layout was baked into the item.
- **A schema that was not an item carried a setting that did nothing**, on
  every one of the eighteen schema types.

It reaches ONE level down. In
`s.array(s.object({ tags: s.array(s.string()) })).render({ as: "inline" })`
the objects are inline and `tags` keeps its own default — a nested list says
so for itself.

The nav-stop rule (`getNavPath`) asks it of the PARENT: an item of an inline
list is not a place navigation can stop, because the list has no row to
navigate from. The add buttons ask it of the list they add to. All three read
the same function, so a row you edit in place cannot have an "add" that
navigates away from it.

`s.router(...)`, `s.imagedir(...)` and `s.filedir(...)` are records, and refuse
a render at definition time: pages and media have UIs of their own that a
render would not reach, and an accepted-but-ignored setting is worse than an
error.

`s.keyOf(...)` takes a render too, and it means something else: the selected
entry's CONTENT is shown below the selector. That is the reference field's own
layout, not a list's, so `isInlineRender` answers `false` for it.

It stays static: the answer is a function of the serialized schema alone,
never of the value a row happens to hold.

## Where each is declared

A `preview` is declared on the schema of the value being previewed — the
ITEM, not the container:

```ts
const author = s
  .object({ name: s.string() })
  .preview(({ val }) => ({ title: val.name }));
const authors = s.array(author);
```

The array reifies its rows by running each item's closure (`executePreviewItem`
in `core/src/schema/index.ts`). A discriminated union without a preview of its own
dispatches to the variant the value takes, so page-builder blocks preview per
block type. A `.preview` on the array/record itself describes the CONTAINER as
a value, for when it is the item of something else.

## Why the plumbing differs

A `render` is static data — no closure, no source — so it travels whole in the
serialized schema and is read where the field is drawn (`core/src/render.ts`).
A `preview` is a user closure over source, so only the host can run it: the
serialized schema carries just a `preview: true` marker, and the Studio asks
the host on demand, scoped to what is on screen (`core/src/preview.ts`,
`ui/spa/stores/PreviewStore.ts`).

## What a declared preview buys, visually

A value that HAS a preview is drawn by `ListPreviewItem`: a compact media row —
thumbnail left, title and subtitle stacked beside it, one line each, truncated
rather than wrapped. It can be laid out that tightly precisely because the
preview told us what the row is made of.

A value with no preview falls back to `Preview`, which renders whatever the
value happens to be, per type. `RefPreview` picks between the two, and pads
both the same so a list does not change density row by row depending on which
branch each row took — callers must not add their own padding on top.

Neither of those is what an INLINE row draws: an inline row draws the field.
The preview reaches it only as the one line of text in its header (see "Where
they meet" above), so a preview on the item of an inline list buys a title to
collapse to rather than a card.

`PreviewItem.image` has three states and they are all load-bearing: an
`ImageSource` draws the thumbnail, `null` means the preview declares an image
this particular value does not have (the column is still reserved, so rows in
a list stay aligned), and `undefined` means no image is declared at all (no
column). Coalescing `null` and `undefined` is what left mixed lists ragged.
