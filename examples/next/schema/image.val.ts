import { s } from "../val.config";

export const image = s.object({
  data: s.image(),
  alt: s.string(),
});
