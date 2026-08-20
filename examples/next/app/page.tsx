import { notFound } from "next/navigation";
import { fetchVal, fetchValRoute } from "../val/rsc";
import pageVal from "./page.val";
import { ValImage, ValRichText } from "@valbuild/next";
import authorsVal from "../content/authors.val";
import themeVal from "../content/theme.val";
import Link from "next/link";
import { val } from "../val.config";

export default async function Home({ params }: { params: unknown }) {
  const page = await fetchValRoute(pageVal, params);
  if (page === null) {
    notFound();
  }
  const authors = await fetchVal(authorsVal);
  const theme = await fetchVal(themeVal);
  const author = authors[page.author];
  return (
    <main style={{ display: "grid", gap: "2rem" }}>
      <section style={{ textAlign: "center" }}>
        <h1>{page.hero.title}</h1>
        <ValImage
          src={page.hero.image}
          style={{
            margin: "0 auto",
            maxWidth: "20rem",
          }}
        />
        {author?.name && <aside>Author: {author.name}</aside>}
        <div>{page.tags.join(", ")}</div>
        <div>
          <Link {...val.attrs(page.hero.link)} href={page.hero.link.href}>
            {page.hero.link.text}
          </Link>
        </div>
      </section>
      <section>
        {page.text && (
          <ValRichText
            theme={{
              bold: "bold",
              italic: "italic",
              lineThrough: "line-through",
              a: "underline",
              h2: null,
              ul: null,
              li: null,
            }}
            content={page.text}
          />
        )}
      </section>
      <section>
        <span>{page.video.text}</span>
        <video src={page.video.file.url} controls />
      </section>
      <section
        style={{
          background: theme.overlay,
          color: theme.text,
          padding: "1rem",
          borderRadius: "0.5rem",
          borderLeft: `4px solid ${theme.brand}`,
        }}
      >
        <h2 style={{ color: theme.accent }}>Theme colors</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(
            [
              ["brand", theme.brand],
              ["background", theme.background],
              ["text", theme.text],
              ["accent", theme.accent],
              ["overlay", theme.overlay],
            ] as const
          ).map(([name, color]) => (
            <div
              key={name}
              style={{ textAlign: "center", fontSize: "0.75rem" }}
            >
              <div
                style={{
                  width: "3rem",
                  height: "3rem",
                  borderRadius: "0.25rem",
                  background: color,
                  border: "1px solid #8888",
                }}
              />
              {name}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
