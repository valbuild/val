import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [{ def: () => import("./blogs.val.ts") }]);
