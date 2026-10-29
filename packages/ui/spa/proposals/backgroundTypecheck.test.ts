import {
  markTypeErrorsTold,
  resetProposalTypecheck,
  scheduleTypecheck,
  typecheckProposal,
  typecheckStatusOf,
  untoldTypeErrors,
} from "./useProposalTypecheck";

const mockRunProposalTypecheck = jest.fn();
jest.mock("@valbuild/shared/typecheck", () => ({
  runProposalTypecheck: (...args: unknown[]) =>
    mockRunProposalTypecheck(...args),
}));
jest.mock("../components/ValProvider", () => ({
  useCurrentProposal: () => null,
}));

const NAME = "0123456789abcdef0123";
const ERROR = {
  file: "src/Hero.tsx",
  line: 1,
  column: 1,
  code: 2322,
  message: "Type 'number' is not assignable to type 'string'.",
};
const client = { files: jest.fn(), reportTypecheck: jest.fn() };

describe("the design tab's background typecheck", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetProposalTypecheck();
    mockRunProposalTypecheck.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  test("runs once after the staged files stop changing, not once per change", async () => {
    mockRunProposalTypecheck.mockResolvedValue({
      status: "done",
      inputs: "a",
      errors: [],
    });
    scheduleTypecheck(NAME, client, () => {}, 2_000);
    jest.advanceTimersByTime(1_000);
    scheduleTypecheck(NAME, client, () => {}, 2_000);
    expect(typecheckStatusOf(NAME)).toEqual({ status: "scheduled" });
    jest.advanceTimersByTime(2_000);
    await jest.runAllTimersAsync();
    expect(mockRunProposalTypecheck).toHaveBeenCalledTimes(1);
    expect(typecheckStatusOf(NAME)).toEqual({
      status: "done",
      inputs: "a",
      errors: [],
    });
  });

  test("a failure is told to the assistant once, and a check of what is staged is answered without running again", async () => {
    mockRunProposalTypecheck.mockResolvedValue({
      status: "done",
      inputs: "a",
      errors: [ERROR],
    });
    scheduleTypecheck(NAME, client, () => {}, 0);
    await jest.runAllTimersAsync();
    expect(untoldTypeErrors(NAME)).toEqual({ inputs: "a", errors: [ERROR] });
    markTypeErrorsTold("a");
    expect(untoldTypeErrors(NAME)).toBeNull();

    const answer = await typecheckProposal(
      NAME,
      client,
      () => {},
      async () => "a",
    );
    expect(answer).toEqual({ status: "done", errors: [ERROR] });
    expect(mockRunProposalTypecheck).toHaveBeenCalledTimes(1);
  });
});
