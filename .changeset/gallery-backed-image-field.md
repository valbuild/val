---
"@valbuild/ui": patch
---

Fix a gallery-backed image field's dead focal point toggle, and a warning about metadata it does not hold

A gallery-backed image field's value is deliberately just `{_ref, _type, _tag}`:
`createFilePatch` is called with `skipMetadataInReplace` for a referenced module,
because the width, height and mimeType live on the gallery's own entry. Two places
assumed otherwise.

**The focal point toggle was a dead control.** Turning the hotspot on only wrote a
patch when there was already a `metadata` object to add to — which such a field
never has. The click wrote nothing, and since the checkbox reads its state from
source, it snapped straight back to off.

**And the field warned about metadata it is not meant to hold** — "Expected
metadata width and height to be numbers but width was: undefined and height was:
undefined", logged after an upload that had worked perfectly well. The check now
applies only where the field really is supposed to carry the dimensions.
