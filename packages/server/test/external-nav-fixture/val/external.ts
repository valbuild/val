import { defineExternal, ok } from "@valbuild/server";
import postsVal from "../content/posts.val";

const { entry, modules } = defineExternal<{ q: string }>({
  around: (run) => run({ q: "" }),
});

export default modules({
  posts: entry(postsVal, {
    keys: async ({ cursor, limit }, { tx }) => {
      void tx;
      void cursor;
      void limit;
      return ok({ keys: [], cursor: null });
    },
    get: async (keys, { tx }) => {
      void tx;
      void keys;
      return ok({ a: { title: "hello", body: "world" } });
    },
    put: async (entries) => {
      void entries;
      return ok(undefined);
    },
    delete: async (keys) => {
      void keys;
      return ok(undefined);
    },
    search: false,
  }),
});
