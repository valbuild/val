---
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/ui": patch
"@valbuild/cli": patch
"@valbuild/core": patch
"@valbuild/eslint-plugin": patch
"@valbuild/init": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Add usePathname to next/navigation exports...

... ideally we should not need to concern ourselves with this - modules should be loaded by the app. Seems like that is not working on Vercel. We believe it is because only cjs files are there. It is possible that next would load fine, so we could remove it from this list. More investigation required.
