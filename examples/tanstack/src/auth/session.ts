import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";

/**
 * A stand-in for a real sign-in: the site's own session, in its own cookie.
 *
 * NOT authentication — anyone can sign in as anyone. It is here so the example
 * has a page behind a login, the shape of a dashboard or an intranet, and so
 * `e2e/tanstack/signedInPreview.spec.ts` can show that Val Studio's preview
 * works on one. What matters is the cookie, and it is the strict kind on
 * purpose: `HttpOnly`, so no script can read it, and `SameSite=Lax`, the
 * default every browser applies to a cookie that names none.
 *
 * Nothing in Val knows it exists. The preview is a same-origin frame, so the
 * browser sends the site's cookies to it like to any other tab.
 */
export const SESSION_COOKIE = "example_session";

/** Who is signed in, or `null`. */
export const getSessionUser = createServerFn().handler(
  (): string | null => getCookie(SESSION_COOKIE) ?? null,
);

export const signIn = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(({ data }) => {
    setCookie(SESSION_COOKIE, data.name, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
