import { useState, useEffect } from "react";
import { Session } from "../dto/Session";
import { Remote } from "../utils/Remote";
import { ValClient } from "@valbuild/shared/src/internal/ValClient";

export function useSession(client: ValClient) {
  const [session, setSession] = useState<Remote<Session>>({
    status: "not-asked",
  });
  const [sessionResetId, setSessionResetId] = useState(0);
  useEffect(() => {
    setSession({ status: "loading" });
    client("/session", "GET", {}).then(async (res) => {
      try {
        if (res.status === 200) {
          const session = res.json;
          setSession({ status: "success", data: Session.parse(session) });
        } else {
          if (res.status === 401) {
            console.error("Unauthorized", res.json);
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
