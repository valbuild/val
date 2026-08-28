---
"@valbuild/ui": patch
---

One patch-id chunker, under the URL length that holds everywhere

Two functions were chunking patch ids into query strings against budgets four
times apart, each naming a different limit as its reason. There is now one, and
it is under the ~2000 characters that are safe for a URL anywhere rather than
the 16KB a Node server happens to accept: that 16KB is configurable, is shared
with the whole request head, and says nothing about the proxy in front, which
answers 413 well below it. The cost is more requests on a very long chain, which
is the honest price of a limit that holds.

The auto-save toggle in the studio shell is also wired to the setting it claims
to control, and shown only in dev, where saving means writing files rather than
making a commit.
