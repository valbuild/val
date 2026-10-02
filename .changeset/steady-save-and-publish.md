---
"@valbuild/ui": patch
---

The Studio no longer blinks while you type.

- The Publish button kept switching between "Fix 1" and "Publish" on every pause in typing whenever the module being edited had a validation error, and the error message under an invalid field disappeared and came back each time. Errors now stay on screen while the module is re-checked, and are replaced when the new result arrives.
- The status bar stays on "Saving…" while you type, then settles on "All changes saved", instead of switching between the two after every pause.
- The save indicator keeps the same width in every state, so the items beside it in the status bar no longer shift.
