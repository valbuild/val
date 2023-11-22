import { initValServer } from "@valbuild/next/server";
import { config } from "./val.config";

const { createValApi } = initValServer(config);

export { createValApi };
