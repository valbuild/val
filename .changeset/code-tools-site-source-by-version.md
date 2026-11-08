---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

The assistant's code tools now see a publish of the site made while the Studio
is open. They read the site's code once and kept that copy for as long as the
page was open, so a file published in the meantime was shown as it was before.
They now ask on every call, and the content service answers "unchanged" without
sending the code again unless it did change.
