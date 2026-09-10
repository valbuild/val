---
"@valbuild/ui": minor
---

Tone of voice comes first in the assistant's settings, and an empty one can
write itself.

**Generate from my content** appears on Tone of voice while it is empty. It asks
the assistant to read a spread of what the project has already published and
describe how it is written — sentence case or title case, British or American,
how formal, whether it uses exclamation marks — and then write that into
`assistant.tone`.

It goes through the ordinary assistant rather than a new endpoint, and that is
worth knowing because of what it means for you: the conversation shows which
modules it read and what it concluded, the answer arrives as a draft you can
edit or discard like any other change, and "shorter" or "we are not that formal"
is just the next message.

The button is only offered while the field is empty — with something in it, a
button that regenerates is a button that loses what you wrote, and a settings
panel has no undo. Clear the field to ask again.

Also: Context now sits below Tone of voice, which is the order you fill them in.

Two accessibility fixes in the same panel, both from these fields being wrapped
in a `<label>`:

- A button inside a label takes the LABEL's accessible name, so the new one
  would have been announced as "Tone of voice, button".
- Everything inside a wrapping label names the control, so each box was
  announced with its whole help text as part of its name. The description is
  `aria-describedby` now, and a validation message goes there too.
