import type { Features } from "./features";

/**
 * Answering the feature questions from the command line instead of a prompt.
 *
 * `npm create @valbuild` is run interactively almost always, but "almost" is
 * why these exist: a scripted setup, a CI check that the template still builds,
 * or a person who already knows what they want and does not want two questions
 * about it. A flag answers the question; anything left unanswered is still
 * asked.
 */

export type FeatureFlags = {
  /** `undefined` where no flag decided it, so the prompt still runs. */
  answers: Partial<Features>;
  /** Arguments with the recognised flags taken out. */
  rest: string[];
  /**
   * A flag that says one thing and its opposite, e.g. `--mcp --no-mcp`.
   *
   * Reported rather than resolved: silently picking one of two contradictory
   * instructions is how a scripted setup quietly produces the wrong project.
   */
  contradiction: string | null;
};

const FLAGS: { on: string; off: string; feature: keyof Features }[] = [
  { on: "--mcp", off: "--no-mcp", feature: "mcp" },
  {
    on: "--image-uploads",
    off: "--no-image-uploads",
    feature: "imageUploads",
  },
];

export function parseFeatureFlags(args: string[]): FeatureFlags {
  const answers: Partial<Features> = {};
  const consumed = new Set<string>();
  let contradiction: string | null = null;

  for (const { on, off, feature } of FLAGS) {
    const saidOn = args.includes(on);
    const saidOff = args.includes(off);
    if (saidOn && saidOff) {
      contradiction = contradiction ?? `${on} and ${off}`;
      continue;
    }
    if (saidOn || saidOff) {
      answers[feature] = saidOn;
      consumed.add(saidOn ? on : off);
    }
  }

  return {
    answers,
    rest: args.filter((arg) => !consumed.has(arg)),
    contradiction,
  };
}

/**
 * `--no-mcp --image-uploads` asks for image uploads with nothing to upload
 * them through.
 *
 * Resolved rather than refused, because the answer is not ambiguous: there is
 * no image tool without an MCP endpoint to serve it, so the narrower flag is
 * the one that cannot be honoured. The caller says so rather than acting
 * quietly.
 */
export function reconcile(features: Features): {
  features: Features;
  warning: string | null;
} {
  if (!features.mcp && features.imageUploads) {
    return {
      features: { mcp: false, imageUploads: false },
      warning:
        "Image uploads are a tool on the MCP endpoint, so --no-mcp turns them off too.",
    };
  }
  return { features, warning: null };
}
