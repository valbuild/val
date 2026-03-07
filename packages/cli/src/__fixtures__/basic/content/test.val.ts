import { initVal } from "@valbuild/core";

const { s, c } = initVal();

export default c.define("/content/test.val.ts", s.string(), "Hello World");
