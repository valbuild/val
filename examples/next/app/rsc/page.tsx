import { ValImage, ValRichText } from "@valbuild/next";
import pageVal, { Content } from "../content.val";
import { fetchVal } from "../../val/rsc";

export default async function Home() {
  const page: Content = await fetchVal(pageVal);
  return (
    <main className="page content">
      <section className="hero full">
        <ValImage
          src={page.hero.image}
          sizes={"(max-width: 400px) 200px, (max-width: 768px) 250px, 300px"}
          priority
        ></ValImage>
        {<h1 className="h1">{page.hero.title}</h1>}
      </section>
      <section>
        <video autoPlay muted>
          <source src={page.video.url} type={page.video.metadata?.mimeType} />
        </video>
      </section>
      <section>
        {page.text && ( // text is optional
          <ValRichText
            theme={{
              p: "rt-paragraph", // optional
              // required based on the content:
              // NOTE: tailwind classes is supported (though tailwind is not used here):
              bold: "font-bold",
              italic: "font-italic",
              lineThrough: "line-through",
              // Classes for tags:
              li: "rt-list-item",
              ul: "rt-ul-list",
              h1: "rt-h1",
              h2: "rt-h2",
              img: "rt-image",
              ol: "rt-ol-list",
              a: "rt-link",
            }}
          >
            {page.text}
          </ValRichText>
        )}
      </section>
    </main>
  );
}
