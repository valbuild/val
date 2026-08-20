---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Improve AI chat session handling. Chat sessions are now "unborn" until the user actually sends a message or uploads an attachment, so opening the studio no longer creates an empty session. Once a session is born its id is written to the URL as `?session=`, preserved across in-studio navigations, and read back on load so refreshing or following a studio link reopens the same conversation. In overlay mode — where the host page URL must not be touched — the id is mirrored to `sessionStorage` instead, so navigating from the overlay to the studio (including via the AI's `navigate_to`) brings the active chat along. Loading a previous session now shows a spinner instead of the empty state, and a session that fails to load resets to the empty state rather than leaving a dead session id in place.
