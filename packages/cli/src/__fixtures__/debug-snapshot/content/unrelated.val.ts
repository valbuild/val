import { c, s } from "../val.config";

// Nothing references this module and no patch touches it, so a debug snapshot
// must NOT include it.
export default c.define("/content/unrelated.val.ts", s.string(), "unrelated");
