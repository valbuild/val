import { ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { useState, useEffect } from "react";
import { Session } from "../dto/Session";
import { Remote } from "../utils/Remote";

export function useSession(api: ValApi) {
  const [session, setSession] = useState<Remote<Session>>({
    status: "not-asked",
  });
  const [sessionResetId, setSessionResetId] = useState(0);
  useEffect(() => {
    setSession({ status: "loading" });
    api.getSession().then(async (res) => {
      try {
        if (result.isOk(res)) {
          const session = res.value;
          setSession({ status: "success", data: Session.parse(session) });
        } else {
          if (res.error.statusCode === 401) {
            console.error("Unauthorized", res.error);
            setSession({
              status: "success",
              data: {
                mode: "unauthorized",
              },
            });
          } else if (sessionResetId < 3) {
            setTimeout(() => {
              setSessionResetId(sessionResetId + 1);
            }, 200 * sessionResetId);
          } else {
            setSession({ status: "error", error: "Could not fetch session" });
          }
        }
      } catch (e) {
        console.error("Could not authorize:", e);
        setSession({
          status: "error",
          error: "Got an error while trying to get session",
        });
      }
    });
  }, [sessionResetId]);
  return session;
}
