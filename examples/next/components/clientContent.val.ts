import { s, val } from "../val.config";

export const schema = s.object({
  text: s.string(),
});

export default val.content("/components/clientContent", schema, {
  text: "Ææææææ!",
});
