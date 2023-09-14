import { NextApiRequest } from "next";
import { draftMode } from "next/headers";
import { NextResponse } from "next/server";

export function GET(req: NextApiRequest) {
  const dm = draftMode();
  if (dm.isEnabled) {
    dm.disable();
    return NextResponse.json({
      draftMode: false,
    });
  } else {
    dm.enable();
    return NextResponse.json({
      draftMode: true,
    });
  }
}
