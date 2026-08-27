# Quirks

Things that are true, surprising, and have each cost someone an afternoon. Add to
this file when you lose time to something a comment could not have told you.

## Authoring

**`export default c.define(...)` must be written inline.** Assigning to a const
and exporting that loads and validates fine, then fails at _publish_ — the server
rewrites the `.val.ts` through its AST and refuses with `Expected default
expression to be a call expression`, having written nothing. So this is broken:

```ts
const gallery = c.define(...);
export default gallery;   // publishes never land
```

**A referenced module must be in `val.modules.ts`.** `s.image(galleryVal)` with the
gallery unregistered renders a field that refuses uploads, with the reason in the
UI. Easy to miss when adding a new module.

## Arrays

**An array item's path is positional** — `?p="0"`, `?p="1"`. A reorder does not move
paths; it moves _content between fixed paths_. Two consequences:

- The list of paths for an array is **unchanged** by a reorder, so "did the array
  reorder" cannot be answered by comparing paths.
- An "uncontrolled" list that holds its own order is **wrong**: the local
  permutation plus the patch's permutation cancel out, and the drag silently does
  nothing. Measured. `SortableList.tsx` carries the note.

## Media

The `/public` URL rule and the `appliedAt` gate — see [media.md](./media.md). The
short version: an uncommitted `/public` path returns **200** in `next dev` (the
app's HTML), so only decoding an image tells you whether it really loaded.

## React in the Studio

**`useValConfig()` returns a ref, filled by an effect.** So the render where config
arrives still sees `undefined`; only the render _after_ that sees it. This makes
config-dependent early returns a hook-order trap, and makes reproducing one in a
test need three renders rather than two.

**Hooks below a guard are a crash waiting for a null value.** Both media field
components did this: an early return for `loading` / `not-found` / `config
=== undefined`, then a `useMemo`. A field whose value is `null` takes the return
on one render and runs more hooks on the next — "Rendered more hooks than during
the previous render", from inside `useMemo`, with nothing in the message about
media. Compute hooks unconditionally and defensively; guard after.

**A context value built inline is a fresh object every render.** Harmless until
something downstream takes it as a `useMemo`/effect dependency — then it is the
whole subtree recomputing per keystroke. `FieldSourceOverrideContext` in the
compare view was exactly this.

**An outside-click listener on `document` cannot see into the Shadow DOM.** The
Studio renders inside a shadow root, so an event listened for outside it has its
`target` **retargeted to the shadow host** — that is what a shadow root is for.
`popup.contains(event.target)` therefore asks "is the shadow host inside this
popup", which is false for every press, the popup's own items included. Every
popup written this way dismisses itself on `pointerdown` and unmounts before the
`mousedown`/`click` can be delivered, so it opens fine, highlights fine, and its
items do nothing — it reads as a dead button, not as a dismissal. Swapping
`onClick` for `onMouseDown`, the usual cure for a list that closes on blur, does
not help: `pointerdown` comes first. Use `event.composedPath().includes(node)`,
which is the path the event actually travelled — `useDismissOnOutsidePointer`
does. This cost the Preview menu's "Open in a new tab" and every suggestion in
the canvas address bar.

**A ref mutated during render survives a discarded render; the `setState` beside
it does not.** So the "adjust state when a prop changes" pattern must hold the
previous prop in **state**, never a ref:

```tsx
// ❌ WRONG — one committed render with the new value, then stuck on the old one
const lastView = useRef(view);
if (lastView.current !== view) {
  lastView.current = view; // survives
  setIsPicking(view === "fields"); // does not
}

// ✅ CORRECT — a discarded render discards both, a committed one commits both
const [viewSource, setViewSource] = useState(view);
if (viewSource !== view) {
  setViewSource(view);
  setIsPicking(view === "fields");
}
```

React is free to throw a render away and start again from the last committed
state. The retained pass then sees the ref already equal to the new prop, skips
the branch, and the derived state stays at its old value **for good**. This is
not a fringe case: `StrictMode` invokes the body twice and keeps the second
result, so it reproduces on demand — which is what makes it testable
(`usePickingDefault.test.tsx` renders the hook inside `StrictMode`; two of its
cases fail against the ref version).

It cost the canvas's select mode: switching to the fields view stopped arming
picking, so the fields list rendered, the Select button read as off, and clicking
anything on the page reported nothing — the bridge only reports while picking.
Nothing in that looks like a missed state update, which is why it went unnoticed
while a real e2e failure sat on it.

**React blames the wrong component for a render loop.** The error surfaces
wherever the update budget ran out — typically a Radix ref callback, whose JS
stack is pure Radix. Do not start there; census the fiber tree instead
(see [stores.md](./stores.md#debugging-in-a-browser)).

## Testing

**`packages/ui` has no jsdom by default**, and importing a field component pulls in
`createValSystem` → the validation worker → `new Worker(new URL(..., import.meta.url))`,
which jest cannot parse. Mock `../validation/schemaValidationBridge` at that seam.

**A render error in jsdom is console noise, not a failed test.** The DOM committed
before the throw still asserts fine, so a test can pass against a crash. Wrap the
subject in an error boundary that records the message and assert on that.

**`rerender()` with the same element reference lets React skip the subtree.** Build
a fresh element each time or the probe never runs again.

**The e2e file input picker is ambiguous.** The AI chat has its own
`input[type="file"]`, and it is `multiple`. Select the field's with
`input[type="file"]:not([multiple])`.

## Dev environment

**After `pnpm run build`, run `pnpm preconstruct dev`** or downstream packages keep
resolving `dist/`. Also delete `examples/next/.next` — a production build left
there makes the dev server 500 with `MODULE_NOT_FOUND` on Studio routes.

## The canvas can refresh before the server has the edit

An edit is applied to the client store the moment you type it and written to the
server asynchronously. `router.refresh()` fired on the edit therefore races the
write: the RSC payload can come back rendered from content that does not include
the patch yet. The canvas flickers and does not change — which looks exactly like
an edit that did not work.

The page has no way to ask whether its patch has been persisted, so it cannot be
closed properly from this side. `ValNextProvider` asks again instead: a safety
refresh every 10s while editing is recent (`SAFETY_REFRESH_MS`,
`SAFETY_REFRESH_WINDOW_MS`). `shouldSafetyRefresh` holds the reasons to skip —
never edited, editing long over, tab hidden, refresh in flight — because each one
is a whole-route request avoided, and in development that is a page re-render.

If you find yourself adding a refresh somewhere, check whether this net already
covers it.

## `suspend` is three waits, and a route only gets one chance

`suspend` on `ValProvider` exists for one situation: a route that exists only in
an uncommitted patch. `useValRoute` returns `null` both for "no answer yet" and
"no such route", the page turns `null` into `notFound()`, and that is terminal —
so a route is not like a field. A field that resolves too early flashes stale
text; a route that resolves too early is a 404 nothing later can undo.

Three things have to be true before the answer is trustworthy, and each was
independently wrong:

1. **Draft mode must be KNOWN.** `draftMode` is `null` until `/draft/stat`
   answers, and the reader that turns a selector into content treats `null` as
   off. So a render that got through while it was unknown resolved against
   committed source. Fixed: the gate waits on `draftModeReady` first.
2. **The draft sources must have arrived — or be known not to be coming.** The
   editor only sends modules it has patches for; an unedited module has no draft
   to send. The page could not tell "not sent yet" from "nothing to send", so it
   waited out `waitForLoad`'s 10s timeout once per unedited module it reads.
   `/blogs/[blog]` also reads the authors module, so a new blog page sat on its
   loading fallback for tens of seconds. Fixed: the editor sends `sourcesSynced`
   when it has handed over everything it holds.
3. **The gate must be ON for the render that decides.** It is not. `ValProvider`
   sets `suspendActive` in an effect, so the SSR and hydration renders never
   consult it — and hydration is where `notFound()` is called. **This one is not
   fixed.**

### Why (3) is not just a bug

It used to work, by exactly the mechanism that would fix it. Before `a4c09b2e`
("Fix suspend to no longer require async layout") the prop was the answer rather
than a request:

```tsx
<ValProvider config={config} suspend={await isValEnabled()}>
```

That made `suspend` true during SSR, so the first render suspended and the route
did not 404 — the old doc comment said so in as many words. It was traded away
because reading `cookies()` server-side forces an async layout and opts every
route into dynamic rendering, which is a real cost to pay on every visitor for
something only editors need. The replacement reads `document.cookie` in an
effect, which is cheap, static — and always too late for a route.

Restoring it is not enough on its own, though — this was tried. With the gate on
during SSR the server suspends on `waitForLoad`, and the store it waits for is
only ever filled from the browser (the studio pushes sources by `postMessage`;
`ValExternalStore` has no server-side writer). So the request does not 404, it
**hangs**: the example app's `/api/val/enable` redirect never finished loading.

That is the actual shape of the remaining work: the server has to be able to
supply draft sources during its own render — which `fetchVal` already does for
server components, via `/sources/~` with patches applied. A client component's
SSR pass has no equivalent, and giving it one is a good deal more than a prop.

### What a visitor pays

Nothing. Measured on a fresh context with no `val_enable` cookie: **zero**
`/api/val` requests, no Val elements in the DOM, and no timers — the refresh
loop, the `/draft/stat` poll and the safety refresh are all behind
`mountOverlay`, which is the cookie. The suspend gates short-circuit on
`suspend`, which stays false. The `draftModeReady` promise is only built when
`props.suspend` is set.

This is worth keeping true, and it is the whole reason (3) above is still open:
the fix for it — the server knowing whether Val is enabled — is the one change
here that WOULD cost a visitor something, because reading `cookies()` opts the
route into dynamic rendering for everyone.

### Where this is pinned

`packages/next/src/client/useValRoute.draft.test.tsx` — one test per state,
including the two that differ ONLY in whether the gate was on for the deciding
render. `e2e/uncommitted-routes.spec.ts` covers the path end to end; its
single-module case is `test.fixme` for (3).
