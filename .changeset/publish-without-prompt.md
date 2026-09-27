---
"@valbuild/core": minor
"@valbuild/ui": minor
---

Publishing no longer asks for a commit message by default.

- **Publish publishes.** In HTTP mode, pressing Publish goes straight to publishing, just as Save already did in local development. Where an AI model is available it writes the commit message (the button reads "Preparing" meanwhile, for up to 15 seconds). Otherwise the message is built from what changed, and names the exact path when a single field changed, e.g. `Update hero.title in /content/home.val.ts`. When several things changed, the message body lists every module and field.
- **`studio.commitMessage: "required"`** in `s.settings()` brings the box back, redesigned. It opens empty rather than pre-filled, so a message cannot be published unread. The AI fills it in when it can, and Publish stays disabled until there is a message. Nothing publishes on its own: the countdown that published while the AI was still writing is gone.
- **The overlay menu stays open** while the commit message popover is open, or a publish is under way. Before, moving onto the popover collapsed the menu and the popover moved with it.
