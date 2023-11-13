import { createRequestListener } from "@valbuild/server";
import { NextApiHandler } from "next";

const handler: NextApiHandler = createRequestListener("/api/val", {
  valConfigPath: "./val.config",
});

export default handler;

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
    externalResolver: true,
  },
};
