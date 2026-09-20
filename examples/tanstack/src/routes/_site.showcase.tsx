import { createFileRoute } from "@tanstack/react-router";
import { Internal, ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import pageVal from "./_site.showcase.val";
import themeVal from "../content/theme.val";
import galleryVal from "../content/gallery.val";
import downloadsVal from "../content/downloads.val";
import mediaVal from "../content/media.val";
import linksVal from "../content/links.val";
import kbVal from "../content/kb.val";
import translatedVal from "../content/translated.val";
import accessVal from "../content/access.val";

export const Route = createFileRoute("/_site/showcase")({
  component: Showcase,
});

/**
 * One section per content module, so the page is a map of the schema types.
 *
 * Everything is read with hooks rather than through a loader: the hooks resolve
 * the published content during SSR and whatever the editor currently holds in a
 * browser with the Studio open, which is what makes every value below
 * click-to-edit.
 */
function Showcase() {
  const page = useValRoute(pageVal, {});
  const theme = useVal(themeVal);
  const gallery = useVal(galleryVal);
  const downloads = useVal(downloadsVal);
  const media = useVal(mediaVal);
  const links = useVal(linksVal);
  const kb = useVal(kbVal);
  const translated = useVal(translatedVal);
  const access = useVal(accessVal);
  // Returned rather than thrown — see the note in _site.index.tsx.
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>

      <section>
        <h2>s.color()</h2>
        <p>{page.notes.theme}</p>
        <ul>
          {Object.entries(theme).map(([name, value]) => (
            <li key={name}>
              <span
                style={{
                  background: value ?? "transparent",
                  border: "1px solid currentColor",
                  display: "inline-block",
                  height: "1em",
                  marginRight: "0.5em",
                  width: "1em",
                }}
              />
              {name}: {value ?? "not set"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>s.imageset()</h2>
        <p>{page.notes.gallery}</p>
        {/*
         * A gallery entry's KEY is the file path, and a bare path is all
         * `Internal.mediaUrl` needs. The metadata — width, height, mime type,
         * alt — is the entry's value, which is the whole point of a collection.
         */}
        {Object.entries(gallery).map(([path, entry]) => (
          <img
            key={path}
            src={Internal.mediaUrl({ path })}
            alt={entry.alt ?? ""}
            width={entry.width}
            height={entry.height}
            style={{ height: "3rem", marginRight: "0.5rem", width: "auto" }}
          />
        ))}
      </section>

      <section>
        <h2>s.fileset()</h2>
        <p>{page.notes.downloads}</p>
        <ul>
          {Object.entries(downloads).map(([path, entry]) => (
            <li key={path}>
              <a href={Internal.mediaUrl({ path })}>{path.split("/").pop()}</a>{" "}
              ({entry.mimeType})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>s.image() and s.file()</h2>
        <p>{page.notes.media}</p>
        <ValImage src={media.hero} style={{ maxWidth: "8rem" }} />
        {media.fromGallery && (
          <ValImage src={media.fromGallery} style={{ maxWidth: "8rem" }} />
        )}
        {media.fromDownloads && (
          <p>
            <a href={media.fromDownloads.url}>The attached handbook</a>
          </p>
        )}
      </section>

      <section>
        <h2>externalPageRouter</h2>
        <p>{page.notes.links}</p>
        <ul>
          {Object.entries(links).map(([url, link]) => (
            <li key={url}>
              <a href={url}>{link.title}</a>
              {link.blurb && <> — {link.blurb}</>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>.jsonValues()</h2>
        <p>{page.notes.kb}</p>
        <ul>
          {Object.entries(kb)
            .sort(([, a], [, b]) => a.order - b.order)
            .map(([key, article]) => (
              <li key={key}>
                <strong>{article.title}</strong> — {article.body}
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2>s.locale()</h2>
        <p>{page.notes.translated}</p>
        <ul>
          {Object.entries(translated.announcements).map(
            ([locale, announcement]) => (
              <li key={locale}>
                {locale}:{" "}
                {announcement ? announcement.title : <em>not written yet</em>}
              </li>
            ),
          )}
        </ul>
        {translated.posts.map((post, i) => (
          <article key={i}>
            <h3>
              {post.title} <small>({post.locale})</small>
            </h3>
            <ValRichText content={post.body} />
          </article>
        ))}
      </section>

      <section>
        <h2>readonly() and hidden()</h2>
        <p>{page.notes.access}</p>
        <p>
          {access.editable} — build {access.buildId} at {access.deploy.commit}
        </p>
      </section>
    </main>
  );
}
