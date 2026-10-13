---
"@valbuild/cli": patch
"@valbuild/create": patch
"@valbuild/init": patch
---

`val connect` now opens [admin.val.build/new](https://admin.val.build/new?hosting=own) in your browser, on "your own hosting", with the GitHub repository and the `val.config.ts` project it found filled in. It says what it found, and prints the link too, for when no browser opens.

`npm create @valbuild` now ends by saying how to connect the new project: push it to GitHub, then pick it on admin.val.build/new or run `val connect`. `@valbuild/init` links to the same page, and now reads the GitHub repository from `origin` correctly.
