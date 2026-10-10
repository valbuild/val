---
"@valbuild/ui": patch
---

Publishing a proposal now works on an iPhone.

An iPhone cannot run the bundler in the Studio page, so Publish in a proposal failed there with "The bundler needs a cross-origin isolated page", and left the proposal stuck while its merge waited for a tab that could build it. Publish in a proposal now does what the site's Publish already did: it opens a tab that can build, and that tab presses the merge, builds it and sees it go live. A proposal with unsaved changes is saved first, and Publish asks for a second tap to open that tab.

Any Studio tab that is handed a waiting merge can now also build it.
