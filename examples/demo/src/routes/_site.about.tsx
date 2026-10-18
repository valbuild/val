import { createFileRoute } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import pageVal from "./_site.about.val";
import authorsVal from "../content/authors.val";
import { NotFound } from "../components/NotFound";

export const Route = createFileRoute("/_site/about")({
  component: About,
});

function About() {
  const page = useValRoute(pageVal, {});
  const authors = useVal(authorsVal);
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main className="page">
      <h1>{page.title}</h1>
      <ValImage className="cover" src={page.image} />
      <div className="prose">
        <ValRichText content={page.body} />
      </div>
      <ul className="team">
        {page.team.map((key) => {
          const person = authors[key];
          if (!person) return null;
          return (
            <li key={key}>
              <ValImage className="avatar" src={person.portrait} />
              <strong>{person.name}</strong>
              <span>{person.role}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
