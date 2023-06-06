export type AuthStatus =
  | {
      status:
        | "not-asked"
        | "authenticated"
        | "unauthenticated"
        | "loading"
        | "local";
    }
  | {
      status: "error";
      message: string;
    };
