import { notFound } from "next/navigation";
import { fetchVal, fetchValRoute } from "../val/rsc";
import pageVal from "./page.val";
import { svgVarsCss, ValImage, ValRichText, ValSvg } from "@valbuild/next";
import authorsVal from "../content/authors.val";
import iconsVal, { iconSchema } from "../content/icons.val";
import Link from "next/link";
import { val } from "../val.config";

export default async function Home({ params }: { params: unknown }) {
  const page = await fetchValRoute(pageVal, params);
  if (page === null) {
    notFound();
  }
  const authors = await fetchVal(authorsVal);
  const icons = await fetchVal(iconsVal);
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
      <section>
        {/* Turns the schema's example colors into the CSS custom properties the
            icons reference. Redefine any of them - in a media query, a
            [data-theme] block, or inline - to retheme every icon at once. */}
        <style>{svgVarsCss(iconSchema)}</style>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          {/* Short form: the icon renders with the schema's example colors. */}
          <ValSvg src={icons.bookmark} size={32} />
          {/* The `line` variable is declared as currentColor, so the bell's
              clapper follows the surrounding text color. */}
          <span
            style={{ color: "#b91c1c", display: "inline-flex", gap: ".5rem" }}
          >
            <ValSvg src={icons.bell} size={32} />
            Inherits currentColor
          </span>
          {/* Long form: override one variable for this usage only. */}
          <ValSvg
            src={icons.check}
            size={32}
            title="Done"
            vars={{ brand: "#15803d", surface: "#f0fdf4" }}
          />
        </div>
      </section>
    </main>
  );
}
