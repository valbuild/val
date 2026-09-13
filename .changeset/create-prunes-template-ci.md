---
"@valbuild/create": patch
---

`create` no longer copies the template repository's own CI into your project

The templates are downloaded whole — that is what lets you clone one directly
and run it — so a workflow a template runs on itself arrived in every new
project too. The TanStack starter now has one (it installs the template weekly
and checks that Val Studio still opens, which is how a bad release gets found),
and in a scaffolded project that workflow is a job about somebody else's
repository. `.github/` is now removed after the template is downloaded.
