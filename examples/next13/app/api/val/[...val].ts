import { NextApiHandler } from "next";
import { createValApi } from "../../../val.server";
import { draftMode } from "next/headers";

const handler: NextApiHandler = createValApi({
  onEnable: () => {
    const dm = draftMode();
    dm.enable();
  },
  onDisable: () => {
    const dm = draftMode();
    dm.disable();
  },
});

export const GET = handler;
export const POST = handler;

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
    externalResolver: true,
  },
};
