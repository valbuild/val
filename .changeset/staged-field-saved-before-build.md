---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

In a proposal in code mode, an edit to a field the assistant has just added is
saved with the assistant's next change, without waiting for the proposal to be
built.

The Studio already let you type into a field that only the assistant's staged
code has. But the save that runs before the assistant's next change applied
your edit to the content as the proposal's last build had it -- without the new
field -- so it failed, and the assistant's next change was refused ("the
changes waiting to be saved could not be saved first") until someone pressed
Build.

Val's server at the proposal's address now learns which staged code the build
it runs was made of (the platform hands it over beside the build), and saves a
module whose code was staged after that build from the staged `.val.ts` itself.
A page at the address keeps reading such a module as its build has it until a
build of the new code serves it, so it never shows content made for code it
does not have.

When the server cannot read a staged module's content without running it --
its content is built by code, or it is a `.jsonValues()` record -- the edit is
kept, and the assistant's change is refused saying the proposal has to be built
first, rather than failing with no reason.

`@valbuild/tanstack-build` rewrites the proposal block of a `val.server.ts`
generated before this, so a site picks it up at its next build.
