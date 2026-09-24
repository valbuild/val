---
"@valbuild/ui": patch
---

The Studio's publish shows how far it has got and what it cost, and a new image no longer disappears while it is being published.

- **An uploaded image stays visible through its publish.** Pressing Publish used to switch a new image to its published URL at once, before any build had it, so it showed as broken (and stayed broken across a reload) until the build went live. It is now served from the saved change until a deployment serves it, the same way the text of the edit is.
- **Publishing N%** replaces the separate progress line in the status bar while a publish runs, and goes away when it is done.
- **"Live"** once a publish is out (was "Deployed"), and a publish that went live from this browser is shown as live straight away instead of reading "Saved, not yet live" until the next status check.
- **The deployments list** shows the step and percentage of a running publish, and how long each step took once it is live.
