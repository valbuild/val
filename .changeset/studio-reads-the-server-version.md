---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/react": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

The Studio now shows each module as your server has it, by version, with only your own unsaved edits on top.

- **Publishing is faster.** After a publish, or when your site serves content published without a build, the Studio used to download every module's content before it showed anything new. It now reads only the modules that changed, one at a time: in our measurements with a 1,000-entry `.jsonValues()` record, the Studio was ready again after a publish in about 35 ms instead of 300–800 ms.
- **No flicker of old content on a draft page.** For up to a minute after a deploy, a request can still reach the build before it; that build now says it has been replaced (when Val's content service can tell it), and the Studio asks again rather than taking its content for the current one. In local development the same holds after you change a `.val.ts`: an answer from the code before the change is no longer taken for the new code's, so a page in draft mode no longer shows the new text, then the old, then the new again.
- **Another editor's change appears as your server has it.** The Studio no longer replays other people's changes on top of the content it loaded with, so a change made against a newer deployment can no longer show up twice or out of order.
- **Less sent with every draft page.** A page in draft mode no longer embeds the whole published content of a site served without a rebuild for the Studio to start from; `ValDraft.base` is deprecated and no longer filled in.
- **When the editor opens on a page that already shows your changes,** the Studio no longer sends them to the page again.
