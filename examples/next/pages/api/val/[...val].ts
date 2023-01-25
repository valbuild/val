import { createDevRequestListener } from "@valbuild/server";
import { NextApiHandler } from "next";

const handler: NextApiHandler = createDevRequestListener("/api/val", {
  valConfigPath: "./val.config",
});

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
