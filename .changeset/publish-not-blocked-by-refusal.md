---
"@valbuild/ui": patch
---

Publish is no longer disabled after the server refuses a change. Previously a refused change turned the button into a disabled "Fix errors" that only discarding the change could clear, even when publishing again would have worked (for example once the deployment had caught up with the previous publish). The server still refuses the whole commit when a change does not apply, so retrying cannot publish anything wrong. The refusal is still shown, and it is now cleared once a retry publishes the change. Validation errors still block publishing.
