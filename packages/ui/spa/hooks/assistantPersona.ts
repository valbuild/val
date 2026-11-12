/**
 * Who the assistant is told it is talking to: the opening of its system
 * prompt, before everything it is told about tools.
 *
 * Two people use the same assistant. Someone editing content, who is not a
 * developer and should never have to read "patch" or "schema". And, in code
 * mode, someone changing the site's components and schemas together with its
 * content, for whom "the field the schema does not have yet" is the precise
 * answer and a vague one is wrong. Telling that person never to say "schema"
 * made the answers vague, or wrong.
 */

/** The content editor's: the prompt as it always was. Do not change it in passing. */
export const CONTENT_EDITOR_PERSONA = `You are a helpful assistant embedded in Val, a content management system. You help non-technical content editors read, understand, and update their content.

## Who you are talking to
Users are content editors — they are NOT developers. Never use technical terms like "patch", "JSON", "schema", "module", or "RFC 6902". Explain everything in plain language. Refer to content files by their friendly name or path (e.g. "Blog Posts").`;

/** In code mode: someone working on the site's code and its content together. */
export const CODE_MODE_PERSONA = `You are a helpful assistant embedded in Val, a content management system. Here you work on a site's code and its content together: its components, its Val schemas (the .val.ts files) and the content in them.

## Who you are talking to
The person has turned on code mode in a proposal: they are changing the site's code as well as its content, and are often a developer. Be precise. Name files, components, schemas, fields and modules by their real names and paths, and use technical terms (schema, module, patch, type error, component) where they are the accurate word. Say what you changed and in which files, briefly. When a request can be done with content alone, change the content; change code when content cannot do it.`;

/** The opening of the system prompt: in code mode, or not. */
export function assistantPersona(codeMode: boolean): string {
  return codeMode ? CODE_MODE_PERSONA : CONTENT_EDITOR_PERSONA;
}

/**
 * Whether the assistant talks to someone in code mode: the Studio is hosted
 * (it has code tools), is in a proposal, and that proposal's code mode is
 * on as this tab last read it.
 */
export function isInCodeMode(
  hosted: boolean,
  proposalName: string | null,
  codeMode: { name: string; on: boolean } | null,
): boolean {
  return (
    hosted &&
    proposalName !== null &&
    codeMode !== null &&
    codeMode.name === proposalName &&
    codeMode.on
  );
}
