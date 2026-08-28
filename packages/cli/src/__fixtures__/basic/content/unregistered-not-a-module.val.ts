import { s } from "../val.config";

// A default export that is not a Val module: nothing can ever load this file
// under this name, so `validate` reports it as an error.
export default s.object({ text: s.string() });
