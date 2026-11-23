---
"@valbuild/ui": patch
---

Code mode no longer flashes while the assistant changes code.

A second after every file the assistant wrote, the Studio made a quick preview and showed it by loading the page again, so the preview went blank for most of a second once per write, each time for a change that was only half made. A change of three edits was three blank pages.

- **One quick preview per change.** It starts when the assistant's turn ends, or when its writes have paused for four seconds, and it shows what the last write left. A burst of edits is one quick preview, not one each. A change staged outside a turn, or by someone else in the proposal, is still shown at once.
- **The page you are looking at stays until the new one is ready.** A new quick preview, and a new build, load behind the page on screen and replace it once they have rendered, at the same place and scroll position. Nothing is swapped in while you are typing in the page, as before. A reload you ask for still reloads in the open.
- **It starts sooner.** The quick preview is asked for with what the write itself answered. The proposal was read twice on the way before, with a second's wait in between.
- **Half the work on Val Build.** Each quick preview was asked for a second time when the page it was shown in came up, and thrown away. It is asked for once.
- The editor no longer re-reads every field after a write that changed no `.val.ts`.
