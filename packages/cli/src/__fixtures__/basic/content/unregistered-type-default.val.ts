import { s } from "../val.config";

// A type-only default export: it does not survive transpilation, so this file
// has no runtime default export and is just a helper.
export const typeDefaultSchema = s.object({ text: s.string() });
type TypeDefault = { text: string };
export type { TypeDefault as default };
