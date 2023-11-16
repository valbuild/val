import { initValRsc } from "@valbuild/next/rsc";
import { config } from "./val.config";

const { fetchVal } = initValRsc(config);

export { fetchVal };
