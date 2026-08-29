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

**Media is recognised from the schema, never from the value.** It is a plain
object with a `path`, so a value that looks like media is not media — and a plain
`s.object({path: s.string()})` must not be treated as it. Anywhere you find
yourself asking "is this an image", the answer has to come from
`schema.type === "image" | "file"`.

**`stegaEncode({disabled: true})` still resolves media.** `disabled: !enabled` is
the normal production path, and it used to drop the schema for the whole
recursion. Harmless while a marker on the value could still be found; the moment
detection needs the schema, it strips `url` from every image on every production
page. `disabled` gates the steganography and nothing else.

**The server drops `patch_id` before writing a `.val.ts`.** It marks a media
source whose bytes are not committed, and it is a sibling of `path` — so a
whole-object write built from the client's optimistic view would print it into a
user's file. Studio media edits are per-property for the same reason.

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

**A `setState` call inside another state updater runs as many times as the
updater does.** Under `StrictMode` — which the SPA mounts in — that is twice, so
the inner update happens twice. `AIChat.completeAssistantMessage` appended the
finished message to `completedMessages` from inside the `setCurrentMessage`
updater, and every assistant reply therefore appeared TWICE in dev, tool activity
and all. It has to be nested (the message being retired lives in
`currentMessage`, and reading it from the render closure would drop a chunk that
streamed in the same tick), so the inner update is keyed by message id and skips
what is already there. If you nest one, make it idempotent.

**An uncontrolled `defaultValue` can be masked by an async gate, and it will not
stay masked.** `StringField`'s textarea worked for years while being
uncontrolled, because the thing that decided it should BE a textarea arrived from
the host a tick after the effect that fills `currentValue` — so by the time it
mounted, the value was there. Making the layout synchronous (it is static schema
config now, not something the host computes) removed that ordering, and the
textarea started mounting at `null`. `.value` still looked right, because a
textarea's value follows `defaultValue` while it is untouched — but
`AutoGrowingTextarea` seeds its invisible sizing ghost from props exactly once,
so the box rendered one line tall for any amount of text. If a field is
uncontrolled, check what is actually keeping it correct before you change the
timing around it. Pinned in `StringField.test.tsx`.

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

## Remote files and proxy mode

**"Does this project use remote files" is `hasRemoteFileSchema` in
`@valbuild/core`, and only that.** There used to be two — the server's, gating
whether `/save` demands remote credentials, and the Studio's
`findRequiredRemoteFiles`, gating the `/remote/settings` fetch — and they
disagreed about `s.images({ remote: true })`. A media collection serializes as a
`record` of metadata with the file named by the KEY, so a walk that only recurses
into `item` finds no image schema and says no; that was the server's answer. If
you add a schema type, teach that one function about it: the `never` assignment in
its default branch is what makes forgetting a compile error.

**A `false` there is silent, not safe.** `saveOrUploadFiles` in `skip-remote` mode
does not merely skip the upload — its loop over remote descriptors is inside the
`upload-remote` branch, so every remote file is dropped with no error. The commit
then lands a remote ref with no bytes behind it. That is why the function throws on
an unknown schema type rather than returning `false`, and why the Studio catches it
at its one call site instead.

**One remote image, file or gallery anywhere makes EVERY publish need remote
credentials.** `/save` in `fs` mode calls `getIsRemoteRequired` over all schemas,
and a single `true` switches the whole save into `upload-remote`, which needs an
api key or a `.val/pat.json`. A local checkout has neither, so adding one
`s.image().remote()` stops a project from publishing plain text. This is why the
example app's remote gallery is opt-in (see `examples/next/val.modules.ts`).

**Every commit failure reads "Unknown error".** `ValOpsHttp.commit` parses the
error body with zod and then passes the _safeParse result_ — not the payload — to
`getErrorMessageFromUnknownJson`, so the service's own message never survives.
When a publish fails in proxy mode, read the content service's log, not the
Studio's.

**A remote upload and the commit that ships it key the same file differently.**
The browser uploads bytes under the file path (the store splits the ref first),
while `prepare` describes the file by its full remote ref. The content service is
what reconciles them.

**The `val_session` cookie is percent-encoded on the wire.** `initValServer`
writes `encodeURIComponent(value)` into `Set-Cookie` and the read side decodes, so
a hand-made session cookie has to be encoded too — an HMAC signature is base64 and
routinely contains `+` and `/`. Sending it raw decodes to something else and reads
as "you will need to login again".

**Only `/stat` can say a publish has gone live, and it is asked rarely.** The
deploy feed's build states (`created` / `pending` / `success` / `failure`) are
relayed from GitHub through the content service, and the socket pushes them — but
none of them means the site is serving the commit. That answer is `/stat`'s
`commitSha`, read from `VAL_GIT_COMMIT` when the app boots, so a finished deploy
is a NEW PROCESS answering with a new sha. Nothing pushes it: while a socket is
up, `/stat` is on a twenty-minute timer, and `awaitingDeploymentInterval` in
`useStatus.ts` is what tightens that to seconds while a publish is outstanding.
The classic (`?val-ui=classic`) layout mounts no deployment UI at all — the feed
lives in the shell's status bar.

**A commit with no deployment shows up in the feed as `created`.** There is no
such build state; `mergeCommitsAndDeployments` invents it for a commit no
deployment has claimed. So a project whose deployment events never arrive — which
is every project whose build host is not wired to the content service — parks
every publish at "Queued" and stays there. `isLive` (Val saw the site answer with
the commit) is deliberately allowed to overrule any build state, including that
one, and that is the only reason such a project ever reaches a resting state.

**The content service returns deployments newest-updated FIRST, the socket
delivers them last.** `getByCommitShas` is `ORDER BY updated_at DESC`; the client
appends socket messages. Both feed the same fold, which keeps the last entry per
commit sha — so anything reading that list has to sort before folding, or a
finished build gets overwritten by the pending one it replaced.

## Patches

**`GET /patches` with no `patch_id` returns every patch.** The filter is applied
to a table the endpoint already holds, so an absent filter is not "none" — it is
"all". Two ways to trip on it:

- Building the query from a list that happens to be empty sends an unfiltered
  request and pulls the whole project's pending changes.
- "I asked for 5 and got 400 back" is not a bug in the server.

The ids go on the query string as repeated `patch_id` params (and `id` for the
delete), and there is no paging. At ~46 characters each, a few hundred pending
changes overruns any of the limits in play — Node caps the request head at 16KB
and answers 431, a proxy caps it lower and answers 413 — so the studio chunks
them (`packages/ui/spa/stores/react/patchIdChunks.ts`). One splitter and one
budget for both endpoints, aimed at the ~2000 characters that are safe for a URL
anywhere rather than at any particular server's cap. Dropping the filter instead
would return the same set today, but then "did I get what I asked for" has no
answer — which is the question that catches a server sending back less than it
announced.

**An id that comes back in neither `patches` nor `errors` means "the server does
not hold it".** That silence is how a deleted patch is observed, so it is not an
error in itself. Whether it is a _fault_ depends on something outside the
response: if `/stat` announced the id, the server has contradicted itself and the
studio reports it; if stat has stopped naming it, it is simply gone. Get those
two backwards and you either resurrect deleted edits as permanent failures, or
wait forever on changes that will never arrive — the second of which is a real
bug that shipped. See `architecture/patch-store.md`.

**A parent the content service does not HOLD is fatal; a parent that is merely
stale is not.** Every write names its parent, and the service answers the two
cases differently: not-the-head is a 409, which `ValOpsHttp` maps to
`patch-head-conflict` and `PatchSync` re-syncs and retries; a parent that has
been deleted is `Parent patch not found` with a status that is not 409, which
becomes `other` → a 400 `patch-error` → `rejected`, and rejected is PERMANENT —
the patch is dropped and the field reverts. So the whole cost of naming a
deleted parent is the editor's work, reported as "An edit could not be saved and
has been reverted."

Which is what a discard used to do. `PatchSync` computes the parent from what
the server has said exists, and the discard told it nothing; worse,
`savedNotInStat` releases an id only when a stat LISTS it, and a deleted patch
never is — so one discard poisoned every later edit until the tab was reloaded.
`patch:drop` now reaches `PatchSync.forget`. Pinned by `e2e/http/discard.spec.ts`
and by "the write after a discard" in `patchSync.test.ts`; the mock content host
answers the two cases apart, which it did not, and could therefore not reproduce
any of this.

**An AI-written `file` op carries a session key where every other one carries
bytes.** An image the editor attaches in the chat is uploaded to the content
service straight from the browser; the assistant is only ever told an opaque key,
and a tool turns that key into patch bytes by asking the SERVICE to copy them
(`patches/{id}/files/from-session-file`). The client never holds the bytes, so the
`file` op it emits has the key as its `value` — and `PatchStore.createPatch`
happily uploaded that string as the file's contents, over the image the service
had just written, on the same (patch id, file path). The image then 404'd in the
Studio and a publish committed a UUID in place of a PNG, with the tool reporting
success throughout. Hence `filesAlreadyUploaded` on `createPatch`: it suppresses
the upload and nothing else — a `file` op with a null value is still a delete and
still runs. Pinned by `e2e/http/aiChat.spec.ts`.

**`/stat`'s patch list can be a polling interval old.** It long polls in `fs`
mode, and it used to answer with the list it read when the poll _opened_ — so the
response that arrives right after a publish still named the patches the publish
committed and deleted. Announced-but-undelivered is therefore not, on its own,
the server contradicting itself: the announcement may simply predate a delete.
`getStat` now reads again before answering, and the studio still gives such an id
one more stat before reporting it. Auto-save is what made this loud, because it
publishes on every pause in typing. See `architecture/patch-store.md`.

**Writing into `.val/patches` wakes the stat that reads it.** `getStat` long
polls on a watcher over the patches directory, so any write in there ends the
poll and the next read happens immediately. That makes every "window" in the
patch write path a window something actually looks into — which is how uploading
an image, whose bytes land a round trip before the patch record that references
them, came to summon the read that classified the half-written directory as lost
work and deleted the bytes. Uploads now land in `.val/uploads/` and are moved in
behind the record, so there is no half-written directory to read; see
[patch-store.md](./patch-store.md).

**The server's committed sources do not come from disk.** `ValOps` memoises them,
and re-reading means awaiting each module's `def` — the app's own `import()`,
which resolves from the module registry. So a save that rewrites a `.val.ts`
cannot be picked up by invalidating the memo: the re-extraction returns the
pre-save content and stores it as fresh. The save tells `ValOps` instead
(`adoptCommittedSources`), which also re-folds the SHAs so `baseSha` moves — the
first thing that moves it within a server's lifetime in `fs` mode, and the signal
`PatchStore.reconcileVanished` needs to tell a publish from a discard.

**A `.jsonValues()` entry needs its own adoption, for a sharper reason.** Its
content is not in the memoised source at all — the source holds markers, and the
content sits behind the marker's own `import()` thunk, which caches the same way.
So there is nothing to re-extract: the memo was never holding it. `prepare` is the
only thing that knows what an entry now holds, and it reports that as
`PreparedCommit.patchedJsonEntries` — **keyed by entry key, not by file path**,
because a marker does not carry its path at read time and two different producers
turn a key into a path (`resolveEntryJsonPath`, and `getNewJsonEntryPaths` for an
`add` or a move's destination). `getJsonEntries` consults the adopted map before
the thunk, as the committed BASELINE, so pending patches still replay on top.

Adopted only for a module whose source was also adopted: the source decides which
keys exist, so taking one without the other would leave the content and the key
set describing different moments.

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

**The assistant panel is hidden, not unmounted.** Every other `FloatingPanel`
comes and goes with `openPanel`; this one stays mounted and takes `hidden`. It
has to: the scrim covers the whole viewport and closes on any click outside, so
carrying on editing while the model works "dismisses" the assistant — and
unmounting it there dropped the turn, because the chat is the only thing that
answers the model's tool calls. So a test cannot assert the chat is ABSENT when
the panel is closed, only that it is not visible; and it still has to click the
top bar's "AI assistant" button to reveal it, which a mobile-width viewport does
not offer at all.

**A field mention can arrive before the chat exists, and then arrive too early.**
"Mention this field" opens the assistant and inserts a reference, and in the
shell the first of those is what mounts the second — so an insert straight after
`openAIChat()` lands on a ref that is still null and the field goes missing with
no error. Hence the queue in `AIChatActionsProvider`; use `insertFieldRef` rather
than reaching for `chatEditorRef` yourself. Draining it from a mount effect is
still not enough: `StrictMode` runs mount effects, cleans up and runs them again,
rebuilding the ProseMirror view in between, so the field went into the view that
was then thrown away. `AIChatSurface` drains on a `requestAnimationFrame` the
cleanup cancels, which is the only pass that writes to the editor that survives.

## Dev environment

**After `pnpm run build`, run `pnpm preconstruct dev`** or downstream packages keep
resolving `dist/`. Also delete `examples/next/.next` — a production build left
there makes the dev server 500 with `MODULE_NOT_FOUND` on Studio routes.

## The `@valbuild/ui` build substitutes placeholders into bundler output

`packages/ui` ships two strings that only get their real values _after_ Vite has
bundled: the package version and the base64 record of the whole SPA build.
`fix-server-hack.js` and `fix-version-hack.js` do that substitution by reading
the emitted `.js` files and replacing `$$BUILD_$$REPLACE_WITH_VERSION$$` /
`$$BUILD_$$REPLACE_WITH_RECORD$$` in the text.

**A bundler is free to re-print a string literal however it likes, and that
breaks the substitution silently.** Vite 8 (rolldown/oxc) constant-folds

```ts
path === `${VERSION ? `/${VERSION}` : ""}${VAL_APP_PATH}`;
```

into one template literal and escapes every `$` while printing it:

```js
path === `/\$\$BUILD_\$\$REPLACE_WITH_VERSION\$\$/app`;
```

Vite 7 kept `const VERSION = "$$BUILD_..."` as its own literal, so the plain
`String.replace` found it. In 0.108.0 it did not, and the placeholder shipped.
Nothing threw: `/api/val/static/0.108.0/app` simply stopped matching, fell
through to the SPA fallback, and every Studio got the index HTML where it asked
for the app bundle — `Failed to load module script: ... MIME type of ""`. The
version in the _client_ bundle was substituted fine, so the URL the browser
asked for was right; only the server's comparison string was wrong.

So the substitution is escape-tolerant (`buildPlaceholders.js`), it fails the
build if a marker survives, and `verify-build.js` loads the packaged server
bundle at the end of `pnpm --filter @valbuild/ui build` and asserts that
`/<version>/app` really comes back as `application/javascript`. **That last
check is the one that does not care how the placeholder is implemented** — keep
it if you ever replace the hacks with something better.

## A request "pending" in dev is usually queued, not slow

The devtools show a request as pending from the moment it is _created_, which
includes the time it spends in the browser's own queue. A browser runs about six
connections per origin over HTTP/1.1, so the seventh simultaneous request to
`/api/val` has not been sent yet — and it looks identical to a request the server
is sitting on.

**The tell is the shape of the wait.** A request that was queued sits for
seconds and then completes in milliseconds; one the server is actually slow on
takes its time in the response. Observed on a `GET /patches` that appeared stuck:
13 seconds pending, then under 50ms to answer. Resource Timing separates the two
directly — `requestStart - fetchStart` is the queue, `responseStart -
requestStart` is the server — which is what `scripts/valRequestReport.js` prints.

Your own capture will often be all `/static/*` — 241 requests of 241, avg
`queuedMs` 324, avg `serverMs` 21. That is not a boring capture, it is the
answer: the queue is the SPA's own module loads, and 324ms of average waiting is
what every other request is sitting behind.

**The dev studio is what fills that queue.** In development
`packages/ui/src/server.ts` is the static handler, and it proxies every
`/api/val/static/*` through the Next server to the Vite dev server on `:5173`,
which serves the SPA unbundled — one request per source file. Measured on
`examples/next`: **608 requests, peaking at 152 in flight.** Anything the editor
asks for during that window queues behind them: `GET /patches`, `POST /stat`, the
next navigation. This is why a save can take a very long time to go green in dev
and then recover on its own. Dev-only — production serves a prebuilt bundle from
`packages/ui/src/vite-server.ts`.

**A parked long poll holds one of those connections.** `POST /stat` in FS mode is
held open for `statPollingInterval`, default **20 seconds** (`ValOpsFS.getStat`).
A request the browser has assigned behind it on the same socket cannot go out
until it returns, which is why a `/stat` and a `/patches` are seen finishing at
the same moment after ~20 seconds — not a shared lock, just a freed connection.

Separately, and real but much smaller: `ValOpsFS.readPatches` reads and
`JSON.parse`s **every** patch on disk before filtering to the `patch_id` that was
asked for, all synchronously on the event loop. Measured against `examples/next`
with a fabricated chain, one-patch `GET /patches`: 8ms at 1 patch, 15ms at 200,
**35–46ms at 650** — and the response is 394 bytes at every length. Called from
`fetchPatches`, `getStat` and `getParentPatchIdFromPatchId`, so the stat poll pays
it too. Enough to notice on a long chain, nowhere near enough to explain a request
that appears to hang.

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
