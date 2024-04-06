import { s, c } from "src/val.config";

const schema = s.object({
  image: s.image(),
});

export default c.define("/src/pages/metadata-tests", schema, {
  image: c.file("/public/managed/images/smallest.png"),
});
