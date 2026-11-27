---
"@valbuild/ui": patch
---

The guided tour works on phones

On a phone, the tour's boxes were drawn around buttons hidden under the panel they had just opened, the assistant's step outlined part of the Data panel, and the steps after it were explained over the conversation. Each step now outlines something you can see: the panel itself, when the button that opens it is covered. The card is a sheet along the bottom (or the top, when the bottom would cover what it points at), and the steps after the assistant's go back to the page.

Steps with nothing to point at, such as the welcome, also dim the screen behind the card again, on every screen size.
