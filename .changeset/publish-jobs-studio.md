---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

Publishing a managed project is now a queued job, and a publish is either live or it did not happen.

Pressing **Publish** in a managed project no longer commits first and builds after. It asks the content service for a publish job and returns at once; the Studio tab that pressed builds the job and uploads it, and the content service checks the build renders and makes it live — recording the commit only then. So there is no longer a "Saved, not yet live" state to get stuck in, and no **Finish publishing** button to get out of it.

- A press made while another publish is going out is queued behind it, and built when its turn comes by whichever open Studio tab is free.
- A tab that closes after uploading costs nothing: the rest of the publish is the content service's.
- A publish that fails before it goes live says so, with **Try again** and **Discard changes**. Your changes are kept either way.
- Publishing from the site (a page that cannot build) still opens a Studio window to build it; the window now runs the publish job for the page.

Connected projects (with a repository) publish exactly as before.

For the Val server: the publish proxy now forwards the publish-job routes, `/api/val/publish-job-prepare` renders a job's sources and hands content its archive, and `/api/val/built-source` is removed.
