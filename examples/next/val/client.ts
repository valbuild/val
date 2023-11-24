import { initValClient } from "@valbuild/next/client";
import { config } from "../val.config";

const { useVal } = initValClient(config);

export { useVal };
