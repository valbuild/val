# Terminology

The words below have one meaning each in this codebase. Using a synonym for one
of them is how a design conversation quietly ends up describing two different
systems.

## Source

**The data of a module.** JSON: objects, arrays, strings, numbers, media
objects, richtext. `Source` in `packages/core/src/source/index.ts` is the type.

This is the thing patches apply to, the thing the Studio edits, the thing a
schema validates. It is what `s.object({...})` describes and what
`c.define(path, schema, ...)` is given.

It is **not** the `.val.ts` file, and it is not a description of that file.
Do not call it "the extracted JSON", "the module data", "the resolved value" or
"the parsed module" — it is the Source, and every one of those synonyms invites
someone to believe there is a fifth concept.

## Module file

The `.val.ts` (or `.val.js`) file on disk. It is **code**: an import list and a
`c.define` call. Its Source is the literal that `c.define` was given.

Getting from a module file to its Source is a static extraction —
`analyzeValModule` + `evaluateExpression` — and it is best-effort. A module
whose value is not a literal has no Source that can be read this way, which is
why `.jsonValues()` modules (`c.json(() => import(...))`) cannot be read from
their module file at all: their Source lives in the `.val.json` beside it.

**Text is not Source.** A variable holding `.val.ts` text is not a "source
file" in this sense however plausible that reads — name it `text`, or
`moduleFileText`. (`previousSourceFiles` on `POST /commit` is exactly this
trap: the name says Source, the value is text.)

## Schema

What a module's Source is allowed to be, built with `s.*`. `SerializedSchema`
is its wire form — the shape the Studio receives and renders fields from.

## Selector

The user-facing type consumers hold: `ObjectSelector`, `ArraySelector`,
`GenericSelector`. Selectors are how content is _read_ in an app; Source is what
is _stored_. See the table in `.claude/CLAUDE.md`.

## Paths

| term             | example                                 | is                                        |
| ---------------- | --------------------------------------- | ----------------------------------------- |
| `ModuleFilePath` | `/content/page.val.ts`                  | which module                              |
| `ModulePath`     | `"hero"."title"`                        | where inside its Source                   |
| `SourcePath`     | `/content/page.val.ts?p="hero"."title"` | the two joined — a specific value         |
| patch path       | `["hero", "title"]`                     | the same location, as JSON Patch wants it |

`Internal.splitModuleFilePathAndModulePath` and `Internal.createPatchPath`
convert between them. A `SourcePath` names a place in a Source; it never names a
place in a module file.
