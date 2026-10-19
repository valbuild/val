---
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The canvas works on a page behind your site's own login.

A site with its own sign-in (a dashboard, an intranet, a members' area) can be edited in the canvas. The canvas is a frame on the same origin as the Studio, so it sends your site's cookies like any other tab: if you are signed in to the site, the canvas shows the page signed in as you.

If you were not signed in, the site redirected the canvas to its login page, and the canvas then broke. That page mounted Val's whole overlay inside the canvas, a Studio inside the Studio. The canvas stayed on "Preview is not ready yet" through the sign-in and after it, until you pressed Reload. Now a page shown in the Studio's canvas counts as the canvas wherever it navigated to, so you can sign in inside the canvas and keep editing.
