import { s } from "../val.config";
import { linkSchema } from "./link";

export const linkButtonSchema = s.object({
  label: s.string(),
  get link() {
    return linkSchema;
  },
});
