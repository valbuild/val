import { s, c } from "../val.config";

const schema = s
  .record(s.object({ sku: s.string() }))
  .readonly()
  .external("skus");

export default c.define("/content/readonly.val.ts", schema, c.external());
