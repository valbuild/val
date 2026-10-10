/**
 * A name for a new proposal, before anyone has thought of one: what New
 * proposal fills its Name field with, selected, so typing replaces it.
 *
 * Every New proposal is a new proposal, so the dialog cannot wait for a name
 * to be invented before it can be pressed -- and "Untitled" twice is two
 * proposals nobody can tell apart in the switcher. Two words, an adjective
 * and a noun, both plain and both neutral, so whatever comes out is fine to
 * keep.
 *
 * `Math.random` is enough: this is a label, not an id. The proposal's id is
 * content's, and the create's id is `randomUUID`'s.
 */
export function randomProposalName(random: () => number = Math.random): string {
  const pick = (words: readonly string[]) =>
    words[Math.min(words.length - 1, Math.floor(random() * words.length))];
  const adjective = pick(ADJECTIVES);
  return `${adjective[0].toUpperCase()}${adjective.slice(1)} ${pick(NOUNS)}`;
}

const ADJECTIVES: readonly string[] = [
  "amber",
  "bright",
  "calm",
  "clear",
  "coral",
  "crisp",
  "early",
  "fresh",
  "gentle",
  "golden",
  "green",
  "light",
  "lively",
  "mellow",
  "misty",
  "northern",
  "quiet",
  "rapid",
  "silver",
  "steady",
  "sunny",
  "swift",
  "warm",
  "wide",
];

const NOUNS: readonly string[] = [
  "bay",
  "birch",
  "brook",
  "cedar",
  "cliff",
  "comet",
  "dune",
  "fjord",
  "garden",
  "harbour",
  "heron",
  "island",
  "lantern",
  "maple",
  "meadow",
  "orchard",
  "otter",
  "pine",
  "river",
  "sparrow",
  "summit",
  "tide",
  "valley",
  "willow",
];
