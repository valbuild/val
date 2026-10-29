---
"@valbuild/ui": patch
"@valbuild/server": patch
---

**The design tab's quick preview is made by Val Build, and shows itself after each change.** Where Val Build builds your project's proposals, a quick preview is bundled there rather than in your browser. It is the same build a Build of the same files makes, so pressing Build afterwards is quicker too. The design tab no longer needs a cross-origin isolated page or a builder tab for it, and it shows each change on its own about a second after the files stop changing.

The proposal is also typechecked in the background after each change, and whenever it is built. The assistant hears about type errors on its next step, can ask where the typecheck is with `typecheck_status`, and is told to call `typecheck` only once its edits are done.

Projects Val Build does not build yet make quick previews in the browser as before, and don't start them on their own.
