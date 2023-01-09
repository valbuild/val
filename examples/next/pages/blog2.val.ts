import { s, val } from "../val.config";

export default val.content("/pages/blog2", () =>
  s
    .object({
      title: s.string(),
      text: s.string(),
    })
    .static({
      title: "HVEM ER VI?",
      text: `I Blank er vi en gjeng på omtrent 50 ulike folk som er ekstremt dyktige i faget vår - digital produktutvikling. Vi er en tredjedel designere og resten teknologer.`,
    })
);
