---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/mcp": patch
---

A save that the content service fails to take no longer looks like a successful one.

Before, when the content service answered a save with a server error (or could not be reached), the Studio treated the edit as invalid and dropped it: the field went back to its old value, and the status bar kept saying "All changes saved". Now:

- **Your edit is kept.** The field keeps what you typed.
- **The Studio says the save failed.** The status bar shows "Could not save" (never "All changes saved" while a save has failed or is still pending), and a notice says which service failed, with the service's own message under **Details**.
- **Try again** sends the same save again. The Studio also retries by itself in the background, so if you leave the tab open your changes are saved once the service is back.

Saves that the service refuses because of your plan, and saves that conflict with someone else's change, work as before.

Error messages from the content service also stop blaming your network. "Could not get your changes. It is most likely due to a network issue. Check your network connection" was shown even when the service had answered with a 500. These messages now say what actually happened (the service answered with an error, refused the request, or could not be reached from your site's server) and name the service. The status code and the service's response are kept as details for whoever needs to look into it. Publish failures now also show the service's own message, where they used to say "Unknown error".
