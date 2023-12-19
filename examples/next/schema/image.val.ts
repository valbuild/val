import { s } from "../val.config";

const image = s.object({
  data: s.image(),
  alt: s.string(),
});

export default image;
