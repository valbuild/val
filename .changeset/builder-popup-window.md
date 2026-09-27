---
"@valbuild/ui": patch
---

When a publish has to be handed to the builder (a publish from the page overlay, or from the Studio in desktop Safari), the builder now opens as a small window over the page instead of a full browser tab. It is sized to the progress card and still closes itself once the change is live. "View the site" and "Open the Studio" open a normal tab and close the builder window. On an iPad the builder is still a tab, because iPadOS always opens one.
