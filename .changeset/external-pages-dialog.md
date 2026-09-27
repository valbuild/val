---
"@valbuild/ui": minor
---

External pages have their own place in Val Studio.

They used to be a second list under the site map in the Pages panel: two dozen
flat rows that pushed the site map out of view and answered none of the
questions anyone opens them with. There is now a button at the bottom of the
Pages panel — with a count, and a second count for how many want looking at —
and behind it a dialog built around what external pages actually are: a list of
URLs.

- **Grouped by domain**, so a project's `status.`, `portal.` and `shop.` links
  read as one cluster rather than three strangers. Flat is a toggle away. A
  `mailto:` groups under the domain it writes to, beside that organisation's
  web pages; a `tel:` gets a heading of its own.
- **Where each URL is used.** Every row says how many places link to it, and
  opening one lists them and takes you there. A link nothing points at is the
  one you can delete; a link twenty things point at is the one you cannot
  rename casually — and until now neither was visible.
- **What is behind it**, without leaving the list: the entry's own fields in a
  detail pane beside the URLs.
- **Add and remove.** A URL can be added from the dialog — which then opens and
  scrolls to what it added, rather than dropping it somewhere in a list sorted
  by a grouping you were not thinking about — and removed from it, but only
  once nothing links to it, which is a thing you could not previously find out
  without reading the project.
- **Validation errors per entry.** A `.validate(...)` your project wrote on the
  external router's item schema now shows on the row it is about, and says what
  it found in the detail pane. Every external page lives in one module, so a
  module-level count said the same thing on every row and was left off
  entirely.
- **Checks.** Press Check on a selection, or on everything, and Val reads the
  URLs for the mistakes that get made while typing and then never looked at
  again: a key the router will refuse, a password pasted into a URL, the same
  page listed twice, an `http://` link whose `https://` twin is already in the
  list, a localhost address someone added from their laptop, tracking
  parameters.
- **Link checking.** The same button also opens each URL through your own
  server and reports what answered: 404 and 410 as errors, a redirect that
  still works as a warning naming where it went, and 401/403/429 as "may be
  fine for a visitor, cannot be checked from here" rather than as broken. URLs
  go up ten at a time and failures are retried, so checking a few hundred links
  is polite to the sites on the other end. A `mailto:` or `tel:` is reported as
  having nothing to open, never as unreachable.

  The report is the findings, not a transcript: the clean rows are a number,
  and each flagged one is one line, worst first. Twenty clean URLs are "All 20
  look fine."

  The endpoint this adds makes outbound requests to addresses your content
  supplies, so it refuses to connect to anything that is not a public internet
  address - loopback, private ranges, and the cloud metadata service that hands
  out credentials - checked on the resolved address, at every redirect hop.
