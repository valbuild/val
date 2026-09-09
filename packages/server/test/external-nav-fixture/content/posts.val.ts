import { s, c } from "../val.config";

const schema = s
  .record(
    s.object({
      title: s.string(),
      body: s.string(),
    }),
  )
  .external("posts");

export default c.define("/content/posts.val.ts", schema, c.external());
