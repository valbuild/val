import { pickDefaultModel } from "./defaultAIModel";
import type { AIModel } from "./useAIWebSocket";

const anthropic = (model: string): AIModel => ({
  provider: "anthropic",
  model,
});
const openai = (model: string): AIModel => ({ provider: "openai", model });

describe("pickDefaultModel", () => {
  test("picks the newest Sonnet, whatever order the provider lists them in", () => {
    expect(
      pickDefaultModel([
        anthropic("claude-opus-5-5"),
        anthropic("claude-haiku-5-5"),
        anthropic("claude-sonnet-5"),
        anthropic("claude-sonnet-5-5"),
        anthropic("claude-sonnet-4-5-20250929"),
        anthropic("claude-fable-5-2"),
      ]),
    ).toEqual(anthropic("claude-sonnet-5-5"));
  });

  test("never reads a snapshot date as a minor version", () => {
    expect(
      pickDefaultModel([
        anthropic("claude-sonnet-4-20250514"),
        anthropic("claude-sonnet-4-5-20250929"),
        anthropic("claude-3-7-sonnet-20250219"),
      ]),
    ).toEqual(anthropic("claude-sonnet-4-5-20250929"));
  });

  test("prefers the alias over a dated snapshot of the same Sonnet", () => {
    expect(
      pickDefaultModel([
        anthropic("claude-sonnet-4-5-20250929"),
        anthropic("claude-sonnet-4-5"),
      ]),
    ).toEqual(anthropic("claude-sonnet-4-5"));
  });

  test("reads the older claude-3-x-sonnet ids", () => {
    expect(
      pickDefaultModel([
        anthropic("claude-3-5-sonnet-20241022"),
        anthropic("claude-3-7-sonnet-20250219"),
        anthropic("claude-3-opus-20240229"),
      ]),
    ).toEqual(anthropic("claude-3-7-sonnet-20250219"));
  });

  test("on OpenAI, picks the newest Sol, not the top tier or a small one", () => {
    expect(
      pickDefaultModel([
        openai("gpt-6-astra"),
        openai("gpt-6.1-terra"),
        openai("gpt-6.1-sol"),
        openai("gpt-6-sol"),
        openai("gpt-6-luna"),
        openai("gpt-5.6-sol"),
        openai("gpt-5.1"),
        openai("gpt-5.1-mini"),
        openai("o3"),
      ]),
    ).toEqual(openai("gpt-6.1-sol"));
  });

  test("on OpenAI without tier names, picks the newest flagship GPT", () => {
    expect(
      pickDefaultModel([
        openai("gpt-5.1-mini"),
        openai("gpt-5.1-nano"),
        openai("gpt-5.1-codex"),
        openai("gpt-5.1-chat-latest"),
        openai("gpt-5.1-2025-11-13"),
        openai("gpt-5.1"),
        openai("gpt-5"),
        openai("gpt-4o"),
        openai("gpt-4.1"),
      ]),
    ).toEqual(openai("gpt-5.1"));
  });

  test("a Sol wins over a bare alias of the same version", () => {
    expect(
      pickDefaultModel([openai("gpt-6.1"), openai("gpt-6.1-sol")]),
    ).toEqual(openai("gpt-6.1-sol"));
  });

  test("Anthropic first when a project has keys for both", () => {
    expect(
      pickDefaultModel([
        openai("gpt-6.1-sol"),
        anthropic("claude-opus-5-5"),
        anthropic("claude-sonnet-5-5"),
      ]),
    ).toEqual(anthropic("claude-sonnet-5-5"));
  });

  test("falls through to OpenAI when the Anthropic key reaches no Sonnet", () => {
    expect(
      pickDefaultModel([anthropic("claude-haiku-5-5"), openai("gpt-6.1-sol")]),
    ).toEqual(openai("gpt-6.1-sol"));
  });

  test("null when nothing follows a scheme it knows", () => {
    expect(pickDefaultModel([])).toBeNull();
    expect(
      pickDefaultModel([anthropic("claude-opus-5-5"), openai("o3")]),
    ).toBeNull();
  });
});
