import { s } from "../val.config";

// A shared schema that happens to wear the `.val.ts` suffix. It has no default
// export, so it is not a Val module and `validate` says nothing about it.
export const helperSchema = s.object({ text: s.string() });
