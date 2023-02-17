import { createRequestListener } from "@valbuild/server";
import { NextApiHandler } from "next";

const handler: NextApiHandler = createRequestListener("/api/val", {
  appBaseUrl: process.env.VERCEL_URL || "http://localhost:3000",
  valConfigPath: "./val.config",
});

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
