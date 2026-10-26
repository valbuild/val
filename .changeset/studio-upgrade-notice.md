---
"@valbuild/ui": minor
---

Upgrades are now made in Val Build. The Studio no longer has an Upgrade dialog or an upgrade tab of its own. Instead, it says when there is something to upgrade ("Val 0.150.0 is out", or that security fixes or updates are out), and that opens the project's **Updates** in Val Build in a new tab. There, the upgrade is typechecked, built, checked by the new Val against the site's content, its pages are rendered, and then it is published.

Settings → Updates lists what there is to upgrade, with **Open in Val Build**. An upgrade already under way is shown above the editor, with a link to its page in Val Build.
