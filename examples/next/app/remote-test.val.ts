import { s, c } from "../val.config";

const schema = s
  .object({
    test: s.string(),
  })
  .remote();

export default c.define("/app/remote-test.val.ts", schema, c.remote("test"));
