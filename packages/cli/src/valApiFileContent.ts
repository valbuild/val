// this will probably change
const fileContent = `
import { createRequestListener } from "@valbuild/server";
import { NextApiHandler } from "next";

const handler: NextApiHandler = createRequestListener("/api/val", {
  valConfigPath: "./val.config",
  mode: "proxy",
});

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
`;
export default fileContent;
