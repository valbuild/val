import "client-only";
import { initValClient } from "@valbuild/next/client";
import { config } from "../val.config";

const { useValStega: useVal } = initValClient(config);

export { useVal };
