---
"@valbuild/shared": patch
---

Stop the serialized-schema parser dropping schema metadata

`SerializedSchema` in `@valbuild/shared` is a zod mirror of the serialized
schema type, and its `z.object`s strip keys they do not declare. Five fields
were declared on some schemas and forgotten on others:

- `customValidate` — missing on twelve of the eighteen schemas. This is the flag
  that says a schema declares a `.validate()`; the function itself cannot
  serialize, so the flag is the only thing that tells the Studio to run the
  custom validators against the real instance.
- `description` — missing on thirteen, so a `.describe()` went unseen.
- `remote` and `referencedModule` — missing on `s.image()` and `s.file()`, so a
  remote field read as local and a gallery-backed field lost the gallery it
  reads its dimensions and mime type from.
- the `message` on a `.regexp(pattern, message)` — so a field with a custom
  pattern message fell back to the generic "Expected string to match reg
  exp: …".

Because it strips rather than rejects, nothing failed and nothing said so. The
live `/schema` route was unaffected — `ValClient` validates the response and
then returns the raw JSON — but the history path consumes the parsed output, so
in a commit or historical patch-set view (`getModuleAtCommit`,
`getHistoricalPatchSet`) a schema's custom validators, description, remoteness
and backing gallery all quietly disappeared.

The fields every serialized schema shares are now spread from one
`commonSchemaFields` object instead of being retyped eighteen times, which is
how they drifted apart in the first place. A round-trip test walks each schema's
serialized output against the parsed result and fails with the path of any key
that did not survive, so a field added to a serialized schema and forgotten in
the parser is caught without anyone having to remember to assert it.
