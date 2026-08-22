---
"@valbuild/ui": patch
---

Close the mobile tools menu when navigating to the compare view.

Below `xl` the tools menu is a sheet drawn over the content area, so clicking Compare in it navigated to a compare view the sheet was still covering. The sheet now closes as part of that navigation.

The layout's menu setters ignored the boolean they were handed and always toggled, which left callers no way to say "closed" — they now set the state they are given. Every existing caller already passed the state it wanted (the header buttons pass `!isOpen`, the sidebar and sheet pass the open state they are moving to), so this only removes the mismatch. The "only one sheet at a time on mobile" behaviour keys off the menu being opened rather than off a toggle's outcome.
