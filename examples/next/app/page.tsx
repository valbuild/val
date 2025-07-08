import { notFound } from "next/navigation";
import { fetchVal, fetchValRoute } from "../val/rsc";
import pageVal from "./page.val";
import { ValImage, ValRichText } from "@valbuild/next";
import authorsVal from "../content/authors.val";

export default async function Home({ params }: { params: Promise<{}> }) {
  const page = await fetchValRoute(pageVal, params);
  if (page === null) {
    notFound();
  }
  const authors = await fetchVal(authorsVal);
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
          >
            {page.text}
          </ValRichText>
        )}
      </section>
      <section>
        <span>{page.video.text}</span>
        <video src={page.video.file.url} controls />
      </section>
    </main>
  );
}
