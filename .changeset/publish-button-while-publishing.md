---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

The Publish button no longer turns green while a publish is still running, in any tab or on any device. Before, the changes being published still counted as unpublished until the publish went live. So from about 64% on the progress, Publish lit up over them again: in the tab that pressed it, in every other open Studio, and on another device.

The button now reads "Publishing" for those changes until the publish is live, and you can press it again only for changes made since. If a publish fails, its changes become publishable again straight away.

Val Build's content service now reports which changes a running publish holds, and the Studio reads that from `/stat` and the live connection. A content service that doesn't report it keeps the previous behaviour, except in the tab that pressed Publish.
