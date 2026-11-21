import { markLintTold, untoldLintProblems } from "./backgroundLint";
import { pageCheckMessagesSource, pageCheckNoticeSource } from "./pageCheck";
import {
  markStagedCodeTold,
  stagedCodeNotice,
  untoldStagedCode,
} from "./stagedCode";
import { markTypeErrorsTold, untoldTypeErrors } from "./useProposalTypecheck";

/**
 * The outbox: what the tab found out in the background and the assistant has
 * not been told, handed over on its next tool answer -- whichever tool it is.
 *
 * The assistant's loop runs on the server and only hears from the tab when a
 * tool answers, so this is how a check that runs beside the conversation,
 * rather than in it, gets back into it without the assistant stopping to ask.
 * Each check keeps its own "told" set and is told once per staged inputs.
 */
export type ToolNotice = {
  /** The key it is handed over under, beside the tool's own `result`. */
  key: string;
  /**
   * The staged inputs it is about, or `null` when it is not about the files
   * as they are now. One about other inputs than are staged now is out of
   * date, and is neither handed over nor marked told.
   */
  inputs: string | null;
  value: unknown;
  /**
   * Whether it asks for a fix: errors do, a passing page check does not.
   * Only these start a turn of their own when the assistant is idle
   * (`checksFollowUp.ts`).
   */
  failing: boolean;
  /** Called once it is handed over: it is not handed over again. */
  markTold: () => void;
};

/** One background check's untold finding about proposal `name`, if any. */
export type ToolNoticeSource = (name: string) => ToolNotice | null;

/** How many type errors and lint problems a notice carries at most. */
export const MAX_NOTICE_ITEMS = 20;

/** The background typecheck found type errors in what is staged. */
export const typecheckNoticeSource: ToolNoticeSource = (name) => {
  const untold = untoldTypeErrors(name);
  if (untold === null) return null;
  return {
    key: "typecheck_errors",
    inputs: untold.inputs,
    value: {
      newErrors: untold.errors.length,
      errors: untold.errors.slice(0, MAX_NOTICE_ITEMS),
      next: "The background typecheck found these in what is staged. Fix them before you build.",
    },
    failing: true,
    markTold: () => markTypeErrorsTold(untold.inputs),
  };
};

/** The background lint found problems in what is staged. */
export const lintNoticeSource: ToolNoticeSource = (name) => {
  const untold = untoldLintProblems(name);
  if (untold === null) return null;
  const fixable = untold.problems.some((problem) => problem.fixable);
  return {
    key: "lint_problems",
    inputs: untold.inputs,
    value: {
      problems: untold.problems.slice(0, MAX_NOTICE_ITEMS),
      ...(untold.problems.length > MAX_NOTICE_ITEMS
        ? { truncated: `${untold.problems.length - MAX_NOTICE_ITEMS} more` }
        : {}),
      next: fixable
        ? "Val's lint rules found these in what is staged. Fix them: the fixable ones with lint and fix: true, the rest in the files."
        : "Val's lint rules found these in what is staged. Fix them in the files.",
    },
    failing: true,
    markTold: () => markLintTold(untold.inputs),
  };
};

/**
 * The tab's evaluation of the staged code finished after the write that
 * started it answered. It is of the last staging, whatever was staged since,
 * so it is not checked against the inputs.
 */
export const stagedCodeNoticeSource: ToolNoticeSource = (name) => {
  const staged = untoldStagedCode(name);
  if (staged === null) return null;
  return {
    key: "valModules",
    inputs: null,
    value: stagedCodeNotice(staged),
    // A schema that moved is news; code that does not run, or content that
    // no longer fits its schema, is a problem.
    failing:
      staged.status === "does-not-evaluate" ||
      (staged.status === "swapped" && staged.invalid.length > 0),
    markTold: () => markStagedCodeTold(staged),
  };
};

/** Every background check whose findings go to the assistant. */
export const TOOL_NOTICE_SOURCES: ToolNoticeSource[] = [
  typecheckNoticeSource,
  lintNoticeSource,
  stagedCodeNoticeSource,
  pageCheckNoticeSource,
  pageCheckMessagesSource,
];

/** How long reading what is staged now may hold a tool answer back. */
export const STAGED_INPUTS_WAIT_MS = 3_000;

/**
 * Take what the assistant has not been told about proposal `name`, marking
 * it told. A finding about staged inputs is handed over only when they are
 * what is staged now; the read that says so is given `waitMs`, never the
 * answer's whole wait, and is made only when there is such a finding.
 */
export async function takeToolNotices(
  name: string,
  stagedInputs: () => Promise<string | null>,
  options: {
    sources?: ToolNoticeSource[];
    waitMs?: number;
  } = {},
): Promise<Record<string, unknown>> {
  return toldNow(await currentToolNotices(name, stagedInputs, options));
}

/**
 * What the assistant has not been told about proposal `name` and is about
 * what is staged now, without marking any of it told: to decide what to do
 * with it first (`checksFollowUp.ts`). {@link toldNow} hands it over.
 */
export async function currentToolNotices(
  name: string,
  stagedInputs: () => Promise<string | null>,
  options: {
    sources?: ToolNoticeSource[];
    waitMs?: number;
  } = {},
): Promise<ToolNotice[]> {
  const untold = untoldToolNotices(name, options.sources);
  if (untold.length === 0) return [];
  const now = untold.some((notice) => notice.inputs !== null)
    ? await within(
        stagedInputs().catch(() => null),
        options.waitMs ?? STAGED_INPUTS_WAIT_MS,
      )
    : null;
  return untold.filter(
    (notice) => notice.inputs === null || notice.inputs === now,
  );
}

/** Every background check's untold finding about proposal `name`. */
export function untoldToolNotices(
  name: string,
  sources: ToolNoticeSource[] = TOOL_NOTICE_SOURCES,
): ToolNotice[] {
  return sources
    .map((source) => source(name))
    .filter((notice): notice is ToolNotice => notice !== null);
}

/** Mark these told, and answer them as they are handed over. */
export function toldNow(notices: ToolNotice[]): Record<string, unknown> {
  const told: Record<string, unknown> = {};
  for (const notice of notices) {
    notice.markTold();
    told[notice.key] = notice.value;
  }
  return told;
}

/** `work`'s answer, or `null` once `ms` have passed without one. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A tool's result with the notices beside it, or the result as it was when
 * there are none -- so a tool answer looks the same as ever until the tab
 * has something to say.
 */
export function withToolNotices(
  result: unknown,
  notices: Record<string, unknown>,
): unknown {
  if (Object.keys(notices).length === 0) return result;
  return { result, ...notices };
}
