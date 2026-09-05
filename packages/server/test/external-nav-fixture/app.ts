import type { ExternalRecordSrc, ValModule } from "@valbuild/core";
import type { ItemOfModule } from "@valbuild/server";
import postsVal from "./content/posts.val";

declare function fetchValKey<M extends ValModule<ExternalRecordSrc>>(
  module: M,
  key: string,
): Promise<ItemOfModule<M> | undefined>;

export async function Page() {
  const post = await fetchValKey(postsVal, "hello");
  return post?.title;
}
