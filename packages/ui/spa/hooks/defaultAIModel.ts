import type { AIModel, AIProviderId } from "./useAIWebSocket";

/**
 * The model the assistant starts on, before anyone has picked one.
 *
 * A rule rather than an id, so the default moves forward on its own when a
 * provider ships a new model: the newest Claude Sonnet, or the newest GPT of
 * OpenAI's equivalent tier. Both are the provider's balanced model -- capable
 * enough for agentic editing, without the price of the top tier (Opus, Astra)
 * on every keystroke-sized request -- so whichever key a project brought, it
 * starts on the same kind of model.
 *
 * Anthropic first when a project has keys for both, then OpenAI.
 *
 * Read from the list the providers REPORT, so a model the key cannot reach is
 * never the default. Null when nothing in the list follows a naming scheme we
 * recognise; the caller then falls back to the built-in catalog.
 */
export function pickDefaultModel(available: AIModel[]): AIModel | null {
  for (const provider of PROVIDER_PREFERENCE) {
    const best = highest(
      available.filter((model) => model.provider === provider),
      RANKERS[provider],
    );
    if (best) {
      return best;
    }
  }
  return null;
}

const PROVIDER_PREFERENCE: AIProviderId[] = ["anthropic", "openai"];

/**
 * Sort key of a model id, compared element by element, larger is better. Null
 * for an id that is not a candidate for the default at all.
 */
type Rank = number[];
type Ranker = (id: string) => Rank | null;

const RANKERS: Record<AIProviderId, Ranker> = {
  anthropic: sonnetRank,
  openai: gptRank,
};

/**
 * `claude-sonnet-5-5`, `claude-sonnet-4-5-20250929`, `claude-sonnet-4-20250514`,
 * and the older `claude-3-7-sonnet-20250219` order.
 *
 * The minor version is one or two digits so that a snapshot date is never read
 * as one: `claude-sonnet-4-20250514` is 4.0, not 4.20250514.
 */
const SONNET_IDS = [
  /^claude-sonnet-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/,
  /^claude-(\d+)(?:-(\d{1,2}))?-sonnet(?:-(\d{8}))?$/,
];

function sonnetRank(id: string): Rank | null {
  for (const pattern of SONNET_IDS) {
    const match = pattern.exec(id);
    if (match) {
      const [, major, minor, date] = match;
      return [
        Number(major),
        Number(minor ?? 0),
        // The undated alias over a dated snapshot of the same version: the
        // alias is the one Anthropic keeps current.
        date === undefined ? 1 : 0,
        Number(date ?? 0),
      ];
    }
  }
  return null;
}

/**
 * OpenAI's equivalent of Sonnet is the Sol tier (`gpt-6.1-sol`): its balanced
 * model, below Astra and above Terra and Luna. A bare `gpt-5.1` is a candidate
 * too, for keys and generations without tier names, but at the same version a
 * Sol id wins -- a bare alias is not promised to point at the balanced tier.
 *
 * Everything else -- `-mini`, `-nano`, `-pro`, `-codex`, `-chat-latest`,
 * Astra, Terra, Luna, `o3`, `gpt-4o` -- is not a candidate. It is still in the
 * picker; it is just never chosen for someone.
 */
const GPT_ID = /^gpt-(\d+)(?:\.(\d+))?(-sol)?(?:-(\d{4})-(\d{2})-(\d{2}))?$/;

function gptRank(id: string): Rank | null {
  const match = GPT_ID.exec(id);
  if (!match) {
    return null;
  }
  const [, major, minor, sol, year, month, day] = match;
  return [
    Number(major),
    Number(minor ?? 0),
    sol === undefined ? 0 : 1,
    year === undefined ? 1 : 0,
    Number(`${year ?? 0}${month ?? ""}${day ?? ""}`),
  ];
}

function highest(models: AIModel[], rank: Ranker): AIModel | null {
  let best: { model: AIModel; rank: Rank } | null = null;
  for (const model of models) {
    const candidate = rank(model.model);
    if (candidate && (best === null || compare(candidate, best.rank) > 0)) {
      best = { model, rank: candidate };
    }
  }
  return best?.model ?? null;
}

function compare(a: Rank, b: Rank): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
