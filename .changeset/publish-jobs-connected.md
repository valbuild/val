---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/cli": minor
---

Connected projects hosted on the Val platform publish as a queued job too.

For a project with a GitHub repository whose site runs on the Val platform, pressing **Publish** is now a request, just as it is for a managed project. The Studio sends the job's changes; the content service pushes them as one commit on top of whatever is on the branch at that moment, so a developer's code push in between is kept. CI then builds it. A developer's change to the site's content files that this deployment has not seen stops the publish before anything is pushed, and says so.

- A build that CI reports as failed shows "Published, not on the site yet", with **View run**. The next publish builds again.
- New CLI command, `val ci-report --status failed|succeeded`, for a workflow's last step. It reads the commit, the branch and the run's address from GitHub Actions, uses the same `VAL_PROJECT_TOKEN` as `val publish`, and never fails the job.

Connected projects on a host of their own (for example Vercel) publish exactly as before.
