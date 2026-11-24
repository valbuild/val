---
"@valbuild/ui": patch
---

Signed out, the Studio's **Log in** button can be clicked again, including on a phone

On a site with Tailwind CSS of its own, the signed-out Studio laid an invisible full-screen layer over its login dialog, so the **Log in** button could not be clicked or tapped and nobody could sign in. The dialog now has one backdrop, inside the Studio.

A signed-out Studio also no longer asks the server for its remote file settings every five seconds while the login dialog is up. They are asked again only after a network error or a server error.
