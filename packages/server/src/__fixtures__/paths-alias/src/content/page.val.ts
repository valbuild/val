// Imports via the tsconfig `paths` alias (`_/*` -> `./src/*`) rather than a
// relative specifier, which exercises the alias branch of loadValModules.
import { c, s } from "_/val.config";

export default c.define("/src/content/page.val.ts", s.string(), "Aliased");
