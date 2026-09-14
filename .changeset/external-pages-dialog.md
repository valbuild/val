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
  read as one cluster rather than three strangers. Flat is a toggle away.
- **Where each URL is used.** Every row says how many places link to it, and
  opening one lists them and takes you there. A link nothing points at is the
  one you can delete; a link twenty things point at is the one you cannot
  rename casually — and until now neither was visible.
- **What is behind it**, without leaving the list: the entry's own fields in a
  detail pane beside the URLs.
- **Checks.** Press Check on a selection, or on everything, and Val reads the
  URLs for the mistakes that get made while typing and then never looked at
  again: a key the router will refuse, a password pasted into a URL, the same
  page listed twice, an `http://` link whose `https://` twin is already in the
  list, a localhost address someone added from their laptop, tracking
  parameters. Nothing is opened over the network yet, and the report says so.
