import { ValImage } from "@valbuild/tanstack";
import { useVal } from "../val/client";
import postsVal from "../routes/_site.journal.$slug.val";

/** The journal's posts, newest first, as cards. */
export function PostCards({ limit }: { limit?: number }) {
  const posts = useVal(postsVal);
  const entries = Object.entries(posts)
    .sort(([, a], [, b]) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
  return (
    <div className="cards">
      {entries.map(([href, post]) => (
        <a key={href} href={href} className="card">
          <ValImage src={post.cover} />
          <h3>{post.title}</h3>
          <p>{post.summary}</p>
        </a>
      ))}
    </div>
  );
}
