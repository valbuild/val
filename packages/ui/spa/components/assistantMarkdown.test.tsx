/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import {
  AssistantImage,
  AssistantLink,
  externalHost,
} from "./assistantMarkdown";

// ESM-only, which this jest setup does not transform. Only the type of
// `Components` is imported from it, but jest still resolves the module.
jest.mock("react-markdown", () => ({ __esModule: true, default: () => null }));

describe("the assistant's markdown", () => {
  test("an image is never loaded: no <img>, so no request", () => {
    const { container } = render(<AssistantImage alt="chart" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("[image: chart]");
  });

  test("an image without alt text is still a placeholder", () => {
    const { container } = render(<AssistantImage />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("[image]");
  });

  test("a link shows its host when the text hides it", () => {
    render(
      <AssistantLink href="https://evil.example/?d=secret">
        the docs
      </AssistantLink>,
    );
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("(evil.example)")).toBeTruthy();
  });

  test("a link whose text is the URL does not repeat the host", () => {
    const { container } = render(
      <AssistantLink href="https://val.build/docs">
        https://val.build/docs
      </AssistantLink>,
    );
    expect(container.textContent).toBe("https://val.build/docs");
  });

  test("a relative link is the Studio's own and shows no host", () => {
    const { container } = render(
      <AssistantLink href="/val/content">here</AssistantLink>,
    );
    expect(container.textContent).toBe("here");
  });

  test("externalHost only answers for http(s)", () => {
    expect(externalHost("https://a.example:8080/x")).toBe("a.example:8080");
    expect(externalHost("mailto:a@b.example")).toBeNull();
    expect(externalHost("/val")).toBeNull();
    expect(externalHost(undefined)).toBeNull();
  });
});
