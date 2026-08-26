# Architecture notes

How Val's parts are meant to fit together, and the quirks that bite when they
don't. Written for a human reading it once, not as a reference to be exhaustive.

| file                     | what it covers                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [media.md](./media.md)   | `s.images()`, `s.files()`, `s.image()`, `s.file()` — collections vs fields, where bytes land, how a URL is chosen |
| [stores.md](./stores.md) | The Studio's client state: ten stores, two realms, and the one rule the whole design turns on                     |
| [quirks.md](./quirks.md) | Things that are true, surprising, and cost someone an afternoon                                                   |
| [logo.md](./logo.md)     | What the Val mark is of — a terminal caret over the brand dot, and why it is always green                         |

## What belongs here

An explanation that took real work to arrive at and would otherwise have to be
re-derived from the code. Two tests for whether a note is worth adding:

- **Would someone reinvent the bug without it?** The `/public` URL rule in
  `media.md` is here because it has been got wrong three times.
- **Is the code unable to say it?** A comment explains one function. This folder
  is for facts that live between several of them.

## What does not

Per-decision history — that is what commit messages and
`packages/ui/spa/stores/openquestions.md` are for. Anything a type or a test
already enforces; write the test instead. And status: "we are migrating X" ages
badly, so say what is true now.

Keep entries short. A note nobody finishes is a note nobody reads.
