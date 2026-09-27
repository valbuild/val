/**
 * A word-level diff of two strings, for the inside of a changed value.
 *
 * Two columns already say THAT a field changed. They are bad at saying what
 * changed inside it: "Content, super-charged" next to "Content, super-charged —
 * and yours to edit" makes the reader diff two sentences by eye, and a colour
 * written as `hsl(217 91% 60%)` next to `hsl(262 83% 58%)` makes them diff
 * three numbers. Payload highlights only the words that moved, and on the same
 * fixture it is the single biggest readability difference between the two
 * views.
 *
 * Words rather than characters: a character diff of two sentences produces
 * confetti — Payload's own output shows it, striking out "Erlend Åmdal" into
 * "Theodor R. Carlsen" one letter at a time — and the unit a person edits text
 * in is the word.
 *
 * Whitespace is carried as its own token so the reconstruction is exact. A diff
 * that normalises spacing would render a value that is not the stored value,
 * which in a review screen is the one thing it must never do.
 */
export type DiffSegment = {
  text: string;
  kind: "same" | "removed" | "added";
};

/**
 * Above this many tokens on either side the diff is abandoned.
 *
 * The table is `before × after` cells, so the cost is quadratic: 600 × 600 is
 * 360k, which is a few milliseconds and happens once per visible row. The next
 * order of magnitude is not, and a field big enough to reach it — a long rich
 * text body pasted from elsewhere — is also one where a word diff has stopped
 * being readable. The fallback is what the view did before: the whole old value
 * and the whole new one.
 */
const MAX_TOKENS = 600;

/**
 * Split into words and the whitespace between them, keeping both.
 *
 * The separators are kept as tokens rather than trimmed, so joining every
 * segment's text reproduces the input exactly.
 */
function tokenize(value: string): string[] {
  return value.split(/(\s+)/).filter((token) => token !== "");
}

/**
 * How long a value may be before a character-level diff is refused.
 *
 * Character diffs are right for IDENTIFIERS — a slug, a filename, a colour —
 * where there are no word boundaries to work with and the change is a few
 * characters inside one token. They are wrong for prose, where they produce
 * exactly the confetti this file's header describes. Length is the usable
 * proxy: identifiers are short, sentences are not.
 */
const MAX_CHAR_DIFF_LENGTH = 80;

/**
 * The diff the view actually shows: words first, characters only as a rescue.
 *
 * `hsl(217 91% 60%)` against `hsl(262 83% 58%)` is the case that forced this.
 * Word-level finds nothing shared — every token differs — and gives up, which
 * is the right answer for two rewritten sentences and the wrong one here: the
 * values are plainly the same shape with three numbers changed. Same for
 * `/blogs/history-restore` against `/blogs/history-and-restore`, which is one
 * token and therefore has no word-level diff at all.
 *
 * So: try words, and if that finds no common ground in a value short enough to
 * be an identifier, try characters. If neither finds anything the two columns
 * already say it, and the caller renders no highlighting at all.
 */
export function valueDiff(before: string, after: string): DiffSegment[] {
  const byWord = wordDiff(before, after);
  if (isWorthDiffing(byWord, WORD_THRESHOLD)) return byWord;
  if (
    before.length <= MAX_CHAR_DIFF_LENGTH &&
    after.length <= MAX_CHAR_DIFF_LENGTH
  ) {
    const byChar = diffTokens([...before], [...after]);
    if (isWorthDiffing(byChar, CHAR_THRESHOLD)) return byChar;
  }
  return byWord;
}

/**
 * How much of the longer value must survive for a diff to be worth showing.
 *
 * Both thresholds were found the same way: by looking at a screen. Two
 * rewritten sentences that happen to share a few short words produced exactly
 * the confetti this file exists to avoid — "Hard-coded content, without the
 * hard-coding." against "Content that ships with your code, and stays
 * editable." — and the first version accepted it, because "any shared word at
 * all" was the rule.
 *
 * The character pass is held to a higher bar than the word pass. Characters
 * find spurious common ground far more easily (every English sentence shares
 * its vowels), so it has to clear more before it is believed.
 */
const WORD_THRESHOLD = 0.3;
const CHAR_THRESHOLD = 0.5;

export function wordDiff(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before === "" ? [] : [{ text: before, kind: "same" }];
  }
  return diffTokens(tokenize(before), tokenize(after));
}

/** The diff itself, over whatever unit the caller tokenized into. */
function diffTokens(a: string[], b: string[]): DiffSegment[] {
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [
      { text: a.join(""), kind: "removed" },
      { text: b.join(""), kind: "added" },
    ];
  }

  /*
   * Longest common subsequence, filled backwards so `lcs[0][0]` is the answer
   * for the whole pair and the walk forwards below can follow the larger of the
   * two neighbours without a second pass.
   */
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  /*
   * Appended rather than pushed blindly: consecutive tokens of the same kind
   * are one segment. Otherwise every word and every space between them becomes
   * its own highlighted span, which both reads as confetti and defeats the
   * point of diffing by word.
   */
  const push = (text: string, kind: DiffSegment["kind"]): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === kind) {
      last.text += text;
      return;
    }
    out.push({ text, kind });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], "same");
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i], "removed");
      i++;
    } else {
      push(b[j], "added");
      j++;
    }
  }
  while (i < a.length) {
    push(a[i], "removed");
    i++;
  }
  while (j < b.length) {
    push(b[j], "added");
    j++;
  }
  return out;
}

/**
 * Whether a diff would tell the reader anything.
 *
 * Two values with nothing in common — a colour replaced wholesale, a sentence
 * rewritten from scratch — produce a diff that is one removed run and one added
 * run, which is exactly what the two columns already show. Highlighting the
 * whole of both sides in that case is worse than highlighting neither: it says
 * "look here" about the entire value.
 *
 * Two conditions. There has to be shared content that is not whitespace — two
 * values sharing only the spaces between their words share nothing a reader can
 * use — and enough of it to be worth pointing at, which is what `threshold`
 * measures. A single shared preposition in a rewritten sentence passes the
 * first and fails the second, which is the whole point of having both.
 *
 * `valueDiff` calls this twice with different thresholds, which is the
 * mechanism by which it falls back from words to characters.
 */
export function isWorthDiffing(
  segments: DiffSegment[],
  threshold = WORD_THRESHOLD,
): boolean {
  const hasRealCommonGround = segments.some(
    (segment) => segment.kind === "same" && segment.text.trim() !== "",
  );
  if (!hasRealCommonGround) return false;
  return sharedRatio(segments) >= threshold;
}

/**
 * How much of the longer side the two values have in common, 0 to 1.
 *
 * Measured against the LONGER side rather than against either one or an
 * average: appending a paragraph to a sentence leaves the sentence entirely
 * shared, and scoring that as a perfect match would highlight a wall of new
 * text as though one word had changed.
 */
function sharedRatio(segments: DiffSegment[]): number {
  let same = 0;
  let before = 0;
  let after = 0;
  for (const segment of segments) {
    if (segment.kind !== "added") before += segment.text.length;
    if (segment.kind !== "removed") after += segment.text.length;
    if (segment.kind === "same") same += segment.text.length;
  }
  const longer = Math.max(before, after);
  return longer === 0 ? 0 : same / longer;
}
