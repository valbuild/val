import type { PatchId } from "@valbuild/core";
import { createValClient } from "./ValClient";

/**
 * A 500 the route declares is an answer the caller reads; one it does not is
 * a failure with a message.
 *
 * Every 500 used to be flattened to its message, so `DELETE /patches` could
 * not tell the Studio which changes a running publish held, nor which ones it
 * had deleted all the same.
 */
describe("a 500 from the server", () => {
  const FIRST = "11111111-1111-4111-8111-111111111111" as PatchId;
  const SECOND = "22222222-2222-4222-8222-222222222222" as PatchId;
  const answering = (body: unknown) =>
    createValClient("/api/val", null, {
      fetch: async () =>
        new Response(JSON.stringify(body), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    });

  it("is handed on as declared when the route declares it", async () => {
    const declared = {
      message: "Failed to delete patches",
      errors: [
        {
          patchId: SECOND,
          message: "It is being published right now.",
          publishJobId: "job-1",
        },
      ],
      deleted: [FIRST],
      headVersion: 4,
    };
    const res = await answering(declared)("/patches", "DELETE", {
      query: { id: undefined },
      body: { ids: [FIRST, SECOND] },
    });
    expect(res).toEqual({ status: 500, json: declared });
  });

  it("is a message when the route does not declare it", async () => {
    const res = await answering({ message: "Something broke" })(
      "/patches",
      "DELETE",
      { query: { id: undefined }, body: { ids: [FIRST] } },
    );
    expect(res).toEqual({
      status: 500,
      json: { type: "unknown", message: "Something broke" },
    });
  });
});
