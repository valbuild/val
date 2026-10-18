import { z } from "zod";

const HandoffAnswer = z.object({ action: z.string(), token: z.string() });

/**
 * Open `target`, a Studio page at proposal `proposal`'s address, already
 * signed in.
 *
 * A plain navigation there arrives without a session, so the address sends the
 * editor through Val Build's sign-in: four screens flash past before the
 * Studio is back. Instead this server seals the session for that address
 * (`/proposal-handoff`), and the sealed handoff is POSTed there in a top-level
 * form; the platform takes it, sets the session and lands on `target`.
 *
 * A form rather than a link so the handoff travels in a body, not in a URL that
 * history and request logs keep. Anything that goes wrong -- an older server,
 * fs mode, a proposal with no address yet -- is a plain navigation, which is
 * the sign-in this replaces, never an error.
 */
export async function goToProposal(
  proposal: string,
  target: string,
  deps: {
    api?: string;
    fetchImpl?: typeof fetch;
    navigate?: (href: string) => void;
    post?: (action: string, fields: Record<string, string>) => void;
  } = {},
): Promise<void> {
  const api = (deps.api ?? "/api/val").replace(/\/+$/, "");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const navigate =
    deps.navigate ?? ((href: string) => window.location.assign(href));
  const post = deps.post ?? postForm;
  let handoff: z.infer<typeof HandoffAnswer> | null = null;
  try {
    const res = await fetchImpl(`${api}/proposal-handoff`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal }),
    });
    if (res.ok) {
      const parsed = HandoffAnswer.safeParse(await res.json());
      if (parsed.success) handoff = parsed.data;
    }
  } catch {
    handoff = null;
  }
  const to = new URL(target);
  // The handoff is for the address it was sealed for; anywhere else, sign in.
  if (handoff === null || new URL(handoff.action).origin !== to.origin) {
    navigate(target);
    return;
  }
  post(handoff.action, {
    token: handoff.token,
    to: `${to.pathname}${to.search}${to.hash}`,
  });
}

function postForm(action: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
