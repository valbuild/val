"use client";
import styles from "./page.module.css";
import blogsVal from "./blogs.val";
import { useVal } from "@valbuild/react";
import { Val } from "@valbuild/lib";
import { val } from "../val.config";

export default function Home() {
  const blogs: Val<{ title: string; text: string | null }[]> = useVal(
    blogsVal.map((blog) => ({
      title: blog.title,
      text: blog.text,
    }))
  );
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        {blogs.map((blog) => (
          <section key={val.key(blog)} className={styles.blog}>
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
