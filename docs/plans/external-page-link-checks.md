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

## The endpoint (not built yet)

`createBatchedProber` in `externalUrlProber.ts` already implements the client
half — batching, retries, abort — on top of a `ProbeBatch` that does one
request. What is missing is the route that `ProbeBatch` calls. Sketch:

```
POST /api/val/external-urls/check
  { "urls": ["https://…", …] }          // at most one batch, see below
→ { "results": { "https://…": { "kind": "answered", "code": 404,
                                "finalUrl": "https://…", "ms": 312 }, … } }
```

Requirements, in the order they matter:

1. **It is a request-forger.** The endpoint makes outbound requests to
   addresses a caller supplies, which is the definition of SSRF. It must refuse
   anything that is not `http:`/`https:`, resolve the host and refuse private,
   loopback, link-local and unique-local addresses **after** resolution (a
   public name can resolve to `169.254.169.254`), refuse to follow a redirect
   into one, and never attach the app's own credentials. `partitionProbeTargets`
   drops the obvious cases client-side first, but that is an explanation, not a
   guard — the server is the one being asked to make the request.
2. **Authenticated like every other Studio route.** It is an editor tool, not a
   public proxy.
3. **`HEAD`, falling back to `GET`.** Some sites answer 405 to `HEAD`; a `GET`
   whose body is discarded costs bandwidth, so only fall back on 405/501.
4. **A timeout** — five seconds is the number the UI's copy assumes — reported
   as `{ kind: "timeout", ms }` rather than as an error.
5. **Follow redirects, report the final URL.** A link that 301s still works and
   has still moved, which is one of the more useful findings; the dialog raises
   it as a warning naming the destination.
6. **Cap the batch.** The client sends ten at a time; the server should refuse
   a batch much larger than that rather than trust it.
7. **No caching of failures across sessions.** A 404 that was fixed an hour ago
   must not still be reported.

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
