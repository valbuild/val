# Checking external pages

The external page router is a record keyed by absolute URL. The Studio's
External pages dialog (`packages/ui/spa/components/shell/ExternalPagesDialog.tsx`)
checks those keys in two halves, and the split is the whole design.

## The two halves

**Shape**, in `externalUrlChecks.ts`. Pure, synchronous, decided from the string
and from the strings beside it: a key the router will refuse, whitespace, a
password in the URL, `http://` where an `https://` twin is already listed, the
same page listed twice, a localhost address, tracking parameters. It costs
nothing, so it runs for every row without anyone asking, and it is what the row
badges show before a check is ever pressed.

**Reachability**, in `externalUrlReachability.ts` and `externalUrlProber.ts`.
Opens the URL and reports what answered. This is what finds link rot, and it is
also the half that cannot be free: it needs the network, it needs a server, and
it needs to be polite to the sites on the other end.

## Why the browser cannot do it

A cross-origin `fetch` from the Studio cannot read a response status unless the
target site sends CORS headers, which no ordinary site has any reason to do. A
`no-cors` request succeeds opaquely for everything — status 0, no headers — so
it cannot tell 200 from 404. The check is therefore a request the **app's own
server** makes, and the dialog takes it as a prop:

```ts
type ExternalUrlProber = (
  urls: readonly string[],
  onResult: (url: string, result: ExternalUrlProbeResult) => void,
  signal: AbortSignal,
) => Promise<void>;
```

Absent, Check still works and reports the shape findings alone — and says so,
rather than implying the links were opened and are fine.

## The endpoint

`POST /api/val/external-urls/check`, declared in `ApiRoutes.ts` and handled in
`ValServer.ts`:

```
  { "urls": ["https://...", ...] }        // 1-20; the client sends 10
-> { "results": { "https://...": { "kind": "answered", "code": 404,
                                   "finalUrl": "https://...", "ms": 312 } } }
```

The zod schema in `ApiRoutes.ts` is the one place the Studio's
`ExternalUrlProbeResult` and the server's `ProbeResult` meet, so the two cannot
drift without failing to parse.

Authenticated like every other Studio route, which in FS mode means not at all:
`getAuth` returns `{ error: null }` there by design, because local dev has no
login, and this endpoint is no more open than `/patches`, which writes content.
In http mode a caller with no session gets 401. `linkCheck/checkRoute.test.ts`
holds both halves.

## The address guard

`linkCheck/addressGuard.ts` is the whole security boundary; everything else in
this feature is presentation. It is a **deny list of address ranges** rather
than an allow list of hostnames, because an editor is allowed to check any real
site and nothing else - loopback, the four private ranges, CGNAT, link-local
(where `169.254.169.254` hands out cloud credentials), unique-local, multicast,
and the reserved and documentation ranges. IPv4-mapped IPv6 is judged as the
IPv4 address it is, or the list would be one `::ffff:` away from useless.

It is applied in **three** places, and it took all three:

1. **In the DNS lookup** (`guardedLookup`), which is what closes the
   check-then-connect window: the socket connects to the address the lookup
   returned, so a name that resolves to a public address once and to 127.0.0.1
   the next time gets no second resolution to exploit.
2. **On a hostname that is already an address**, per redirect hop. `net.connect`
   detects an IP literal and connects straight to it, so `guardedLookup` is
   never called for `http://169.254.169.254/` - the single most valuable URL an
   attacker could ask this server to open. This was a real hole, and the test
   that found it was the one asserting a local server received _nothing_, not
   the one asserting a function returned a string.
3. **With the IPv6 brackets off.** `new URL("http://[::1]/").hostname` is
   `"[::1]"`, and `net.isIP` says 0 to that, so the bracketed form sailed past
   the literal check and failed later as "host could not be found" - which
   looks like a refusal and is not one. Assert the reason, not just the failure.

Also refused: a redirect whose `Location` leaves http(s) (the address guard
never sees a `file:` URL), and more than five hops.

Every request is made with `agent: false`. Node's default agent pools sockets
between requests, and a pooled socket was resolved by a _previous_ lookup.

## What is sent

`HEAD`, falling back to `GET` only on 405 and 501 - where the server said the
METHOD was the problem. A 403 is the tempting third case, and some WAFs do
refuse HEAD with one, but retrying every 403 with a GET means downloading a
page for each of them and buys little: 403 is already reported as "may be fine
for a visitor" rather than as a broken link.

The body is never read. A status and a `Location` is the whole answer, and
downloading a page to throw it away is bandwidth spent on somebody else's
server. The request carries a `User-Agent` naming itself and nothing else - no
cookies, no authorization, none of the app's identity.

## Batching and retries

Both live in `createBatchedProber`, and both are about the thousand-URL case: a
site that has been edited for years accumulates external links, and "check them
all" must not become a thousand simultaneous outbound requests from the app's
server — which is a denial of service against the app, and looks like one to
whoever is on the other end.

- Batches of ten, run one after another. At most ten sockets open at a time.
- Three attempts per URL, backing off 500 ms then 1 s.
- Retries are for **failures to get an answer**, not for answers: a timeout, a
  refused connection, a 5xx, a 429. A 404 is an answer — asking three times
  gets three 404s more slowly, and on a site with four hundred dead links that
  is three times the traffic to produce the same report.
- Each URL is reported once, as soon as its result is final, so the report
  fills in while later batches are still running.
- Aborting stops between batches and between attempts. URLs that were never
  reached are never reported, which leaves their rows unchecked rather than
  failed — a row stuck on a spinner is worse than one that says nothing.

`externalUrlProber.test.ts` holds all of that, with time injected so nothing
sleeps.

## Statuses that are not failures

401, 403 and 429 are reported as warnings, not errors. A page behind a login
answers 403 to an anonymous server and 200 to the person who added the link;
a rate-limiting site answers 429 to anything checking forty URLs at once.
Calling those broken would train everyone to ignore the check, which is worse
than not having one.
