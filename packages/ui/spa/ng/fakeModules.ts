import { initVal, modules } from "@valbuild/core";

export const { s, c, config } = initVal();

export default modules(config, [
  {
    def: () =>
      Promise.resolve({
        default: c.define(
          "/content/events.val.ts",
          s.array(
            s.object({
              title: s.string(),
              date: s.string(),
              description: s.string(),
            })
          ),
          [
            {
              title: "The first event",
              date: "2022-01-01",
              description: "The first event description",
            },
            {
              title: "The second event",
              date: "2022-02-02",
              description: "The second event description",
            },
          ]
        ),
      }),
  },
]);
