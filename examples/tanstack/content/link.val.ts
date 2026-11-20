import { s } from "../val.config";

export const linkSchema = s.object({
  label: s.string(),
  href: s.route(),
});
