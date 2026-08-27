---
"@valbuild/ui": patch
"@valbuild/server": patch
---

Fix the Studio hanging on "Loading patches" with a few hundred unpublished changes

A studio told about 410 unpublished changes received 359 and waited on the rest
forever, saying nothing. Two independent causes, both of which only appear once
a chain is long enough:

- Every pending id went on one `GET /patches` query string — about 19KB at 410
  changes, which Node refuses before the handler runs. The read is chunked now,
  into batches whose URLs fit, so a long chain is several requests rather than
  one rejected one.
- The local-dev patch store is an append-only log behind a lock, so a
  concurrent write can no longer leave it in a state the server reads back as
  fewer patches than it announced.

The silence is fixed independently of the cause: changes that `/stat` names and
the fetch does not return are now reported to the person editing, because
anything they type is written on top of content that is missing them. Changes
the server discarded on its own because it could not read them are reported
too - the fields go quietly back to their published values otherwise.
