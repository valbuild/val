---
"@valbuild/ui": patch
---

The preview notice says one thing, and the setup instructions are always reachable

The bar over the canvas used to say "Preview is not ready yet" _next to_ the
button that makes it ready, which reads as two problems rather than one act —
and the sentence said less than the button did. Where there is a fix, the
button is now the whole of the message. The diagnosis ("Preview mode is off",
"No answer from the page") comes back beside it once the twenty-second wait is
up, because by then the button has been there without working and which way it
is failing is the useful part. Turning preview mode on said so twice, with two
spinners; it says so once.

The developer's setup checklist was behind Details, and only offered where the
page never answered — which withheld it from exactly the person who needs it:
press the button, land back on "preview mode is off", and that was the one
state with no route to the setup help. It is now offered in every state the
canvas is not working in, still folded away.

Details also stops keeping the pill's silence. The pill withholds a diagnosis
for the first stretch because it appears without being asked for, over a page
that is very often just compiling. The panel was opened on purpose, so it says
what is known straight away.

The On page view's empty card no longer explains preview mode a second time. It
says what it is ("Nothing reported yet") and points at the one place that has
both the reason and the button.
