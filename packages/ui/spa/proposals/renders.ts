import { renderIdOf } from "@valbuild/shared/internal";
import { stagedPreview, subscribeStagedPreview } from "./quickPreviewControl";

/**
 * The Studio's render ids (`renderMark.ts` in `@valbuild/shared` says what
 * they are): each change a tool makes to what the page in the preview shows
 * -- a content edit, a quick preview, a Build -- is minted one here, and the
 * page is told it (`render` in the canvas protocol) once the change can be
 * on it. The page writes it on itself once it shows it, and `read_page`
 * with `at` waits for it.
 *
 * - **An edit** is sent at once, with the version of the server's content
 *   the page has to show first (`seq`): the page holds it until its loaders
 *   have re-read that version.
 * - **A quick preview or a Build** is of staged files (`inputs`): sent once
 *   the page in front is of them -- `shown` (a quick preview) or `served` (a
 *   build that has them), as `setStagedPreview` says.
 * - **Each id needs at least what the one before it needed** (its `seq`),
 *   so a page that shows an id shows every change before it: "this id, or
 *   a later one" is then a fact about the page, not a guess.
 * - **A page loaded again** (a new document) is told every id it can show,
 *   since it starts from nothing.
 *
 * Module state, like `quickPreviewControl.ts`: one Studio per tab, and the
 * page in its preview is one target at a time.
 */

/** What a change needs before the page can show it. */
export type RenderNeeds = {
  /**
   * The staged files the page has to be of, or `null` for those of the
   * change before it: staging only grows, so an edit made after a quick
   * preview of X is on a page of X.
   */
  inputs: string | null;
  /**
   * The server's content version the page has to show, or `null`: or, for
   * an edit not saved yet, the version its save makes.
   */
  seq: number | null | Promise<number | null>;
};

type Render = {
  id: string;
  inputs: string | null;
  /** `undefined` until the save says it. */
  seq: number | null | undefined;
};

/** How many are kept for a page loaded again: plenty for a turn's changes. */
const KEPT = 50;

const startedAt = Date.now();
let count = 0;
let renders: Render[] = [];
let lastInputs: string | null = null;
type Target = {
  send: (id: string, seq: number | null) => void;
  sent: Set<string>;
};
let target: Target | null = null;

function canShow(render: Render): boolean {
  if (render.inputs === null) return true;
  const now = stagedPreview();
  return (
    now !== null &&
    now.inputs === render.inputs &&
    (now.status === "shown" || now.status === "served")
  );
}

function sendReady(): void {
  const to = target;
  if (to === null) return;
  for (const render of renders) {
    // In order: one whose version is not known yet holds the ones after it,
    // which need at least what it does.
    if (render.seq === undefined) return;
    if (to.sent.has(render.id) || !canShow(render)) continue;
    to.sent.add(render.id);
    to.send(render.id, render.seq);
  }
}

/** At least what the render before it needs: see the module comment. */
function atLeastBefore(render: Render, seq: number | null): number | null {
  const at = renders.indexOf(render);
  const before = at > 0 ? renders[at - 1]?.seq : null;
  if (before === undefined || before === null) return seq;
  return seq === null ? before : Math.max(before, seq);
}

/** The versions after `from` that waited for it. */
function settleAfter(from: number): void {
  for (let i = from; i < renders.length; i++) {
    const render = renders[i];
    if (render === undefined) continue;
    const own = ownSeq.get(render.id);
    if (own === undefined) return;
    render.seq = atLeastBefore(render, own);
  }
}

/** Each render's own version, as minted or as its save said. */
const ownSeq = new Map<string, number | null>();

subscribeStagedPreview(sendReady);

/** Mint the id of a change the page will show, and tell the page when it can. */
export function mintRender(needs: RenderNeeds): string {
  count++;
  if (needs.inputs !== null) lastInputs = needs.inputs;
  const render: Render = {
    id: renderIdOf(startedAt, count),
    inputs: needs.inputs ?? lastInputs,
    seq: undefined,
  };
  renders = [...renders.slice(-(KEPT - 1)), render];
  const known = (seq: number | null) => {
    ownSeq.set(render.id, seq);
    const at = renders.indexOf(render);
    if (at === -1) return;
    settleAfter(at);
    sendReady();
  };
  if (needs.seq instanceof Promise) {
    void needs.seq.then(known, () => known(null));
  } else {
    known(needs.seq);
  }
  return render.id;
}

/**
 * The page in the preview, ready for render ids: each new document
 * connects, and is sent every id it can show. Returns the disconnect.
 */
export function connectRenderTarget(
  send: (id: string, seq: number | null) => void,
): () => void {
  const mine: Target = { send, sent: new Set() };
  target = mine;
  sendReady();
  return () => {
    if (target === mine) target = null;
  };
}

/** For tests: no ids, and no page. */
export function resetRenders(): void {
  renders = [];
  lastInputs = null;
  ownSeq.clear();
  target = null;
}
