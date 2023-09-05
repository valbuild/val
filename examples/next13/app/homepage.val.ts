import { s, val } from "../val.config";

export const schema = s.object({
  title: s.string(),
  text: s.string(),
  description: s.string(),
});

export default val.content("/app/homepage", schema, {
  title: "My fantastic homepage asdasdasdasd",
  text: "This is my homepage, and it will be a great homepage. The content on my rwerwerwerwer will be awesome!",
  description:
    "This text describes my homepage. It is a great homepage, and it will be a great homepage. The content on my homepage will be awesome!",
});
