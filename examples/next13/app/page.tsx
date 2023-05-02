"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";
import { Val, ValImage } from "@valbuild/lib";

export default function Home() {
  const blogs: Val<{ title: string; text: string | null; image: ValImage }[]> =
    useVal(
      blogsVal.select((blogs) =>
        blogs
          .sortBy((blog) => blog.rank)
          .map((blog) => ({
            title: blog.title,
            text: blog.text,
            image: blog.image,
          }))
      )
    );
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.map((blog) => (
          <section key={blog.valSrc} className={styles.blog}>
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
            <img src={blog.image.url} />
          </section>
        ))}
      </article>
    </main>
  );
}
