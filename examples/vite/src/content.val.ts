import { s, val } from "./val.config";

export default val.content("/content", () => s.string().fixed("Hello Vite!"));
