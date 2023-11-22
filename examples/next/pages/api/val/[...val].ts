import { NextApiHandler } from "next";
import { createValApi } from "../../../val.server";
import { NextRequest } from "next/server";

const handler: NextApiHandler = createValApi();

export default handler;

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
    externalResolver: true,
  },
};
