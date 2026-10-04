---
"@valbuild/ui": patch
---

The Publish button no longer turns green while your own publish is still running. When a Studio tab had handed its build over (around 64% on the progress), the change being published still counted as unpublished, so Publish lit up over it until the publish finished. It now reads "Publishing" until the publish is live, and is only pressable again for changes made since.
