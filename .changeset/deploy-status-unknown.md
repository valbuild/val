---
"@valbuild/ui": patch
---

A deploy that has reported itself as queued or building for more than an hour is now shown as **Status unknown** instead of building.

The build state comes from the hosting provider. When those updates stop arriving, a publish used to show a spinner indefinitely. The status bar, the deploy list, Recent activity and the compare view now all say "Status unknown" once the hour has passed, and switch over at that moment without needing a reload. A publish the site is already serving still shows as live. In a project the Studio deploys itself, a commit is recorded only once its build is live, so a row the site does not serve was superseded and reads "Published".
