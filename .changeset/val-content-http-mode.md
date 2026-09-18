---
"@valbuild/tanstack": minor
---

`initValContent` takes an `http` option, so the content readers can be put in
http mode.

They build a Val server of their own — they resolve content by asking it, not by
calling the API over HTTP — so the mode question is put to them separately.
`initValServer` has had `http` for a while; these readers did not, which meant a
host could configure its API for http mode and leave the half of Val that
renders its pages inferring a mode instead. Where the credentials are handed to
Val in code rather than through the environment there is nothing to infer from,
because `process.env.VAL_API_KEY` is undefined in a bundle built separately from
its dependencies.

Pass the same object both halves get. `gitCommit` is the field that is silently
wrong rather than loudly missing: every read in this mode fetches the module's
path from the content service at that commit, so readers given a different one
from the API resolve a different version of the same file — a draft render
showing content that is neither the draft nor what the site serves, with nothing
failing anywhere.
