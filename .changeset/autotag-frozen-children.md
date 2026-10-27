---
"@valbuild/react": patch
---

In development, a component that passes its children on to a link or another element -- `<TextLink>{label} →</TextLink>` -- no longer leaves the edit tag in the text. React's development build freezes those children, and Val tagged the element without cleaning its text, so the leak warning named it. Production was not affected.
