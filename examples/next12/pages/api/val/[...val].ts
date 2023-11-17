import { NextApiHandler } from "next";
import { createValApi } from "../../../val.server";

const handler: NextApiHandler = createValApi();

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
