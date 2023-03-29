"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";
import {
  Descriptor,
  DetailedObjectDescriptor,
} from "@valbuild/lib/src/descriptor";

export default function Home() {
  const a = blogsVal.select((it) =>
    it.andThenAlt<DetailedObjectDescriptor<{ first: Descriptor }>>((it) => ({
      first: it[0],
    }))
  );
  const b = a.getVal(a.getModule().content.source, "en_US");
  const c = b.val && b.first;
  if (c !== null) {
    const d = c.title;
  }
  const blog = useVal(blogsVal.select((it) => it.andThen((it) => it[0])));
  const blogs = blog.val === null ? [] : [blog];
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.map((blog) => (
          <section key={blog.valSrc} className={styles.blog}>
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
