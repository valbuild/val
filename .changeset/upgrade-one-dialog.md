---
"@valbuild/ui": patch
---

Upgrading a site's dependencies now happens in one dialog, from the moment the upgrade proposal opens until **Go to site**.

- The dialog opens straight away at the proposal's address and says it is loading, instead of appearing only once everything has loaded.
- The build starts by itself once the upgrade's dependencies are built, and the dialog shows how far it has got: reading, building, uploading N of M, serving at the proposal's address. On an iPhone, where the build runs in a new tab, it asks for one tap to open that tab.
- A step that fails says why, with **Try again** where **Publish** is. Publish runs inside the same dialog, which ends with **Go to site**, so there is no second Publish dialog.
- A gateway timeout (such as Cloudflare's 524) while the build is put up at the proposal's address no longer fails the build. The Studio waits until Val Build says the proposal is built.
- A proposal's build now leaves lockfiles out, as a publish does. Publishing an upgrade can then go live on the build the proposal already has, instead of building the whole site again.
