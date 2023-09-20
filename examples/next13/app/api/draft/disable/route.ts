import { Internal } from "@valbuild/core";
import { draftMode } from "next/headers";
import { NextResponse } from "next/server";

export function GET(req: Request) {
  const { searchParams: params } = new URL(req.url);
  const redirectTo = params?.get("redirect_to") || "/";

  //
  const dm = draftMode();
  dm.disable();
  //

  const res = NextResponse.redirect(new URL(redirectTo, req.url));
  res.cookies.set(Internal.VAL_DRAFT_MODE_COOKIE, "false", {
    httpOnly: false,
    sameSite: "lax",
  });
  return res;
}
