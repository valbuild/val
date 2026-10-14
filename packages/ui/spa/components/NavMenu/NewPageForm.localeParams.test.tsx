/** @jest-environment jsdom */
import { initVal, ModuleFilePath } from "@valbuild/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseRoutePattern } from "@valbuild/shared/internal";
import { AvailableRoute, NewPageForm } from "./NewPageForm";
import { ProjectLocalesContext } from "../../hooks/useProjectLocales";

const { s } = initVal();

/**
 * A route whose URL names its language: the language is picked from a list
 * above the URL, and the URL row shows what that choice puts there.
 */
function route(
  pattern: string,
  routeParams: AvailableRoute["routeParams"],
): AvailableRoute {
  return {
    moduleFilePath: "/src/routes/news.val.ts" as ModuleFilePath,
    routePattern: parseRoutePattern(pattern),
    patternString: pattern,
    existingKeys: [],
    routeParams,
  };
}

function renderForm(available: AvailableRoute) {
  const onSubmit = jest.fn();
  render(
    <ProjectLocalesContext.Provider value={["en-US", "nb-NO"]}>
      <NewPageForm
        routes={[available]}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    </ProjectLocalesContext.Provider>,
  );
  return onSubmit;
}

describe("NewPageForm with a language in the URL", () => {
  const urlLocale = s
    .enum("nb")
    .nullable()
    .locales({ nb: "nb-NO" }, { null: "en-US" })
    ["executeSerialize"]();
  const slug = s
    .string()
    .describe("Lower case letters, digits and hyphens")
    ["executeSerialize"]();

  test("starts on 'no prefix', and creates the unprefixed page", () => {
    const onSubmit = renderForm(
      route("/[[locale]]/news/[slug]", { locale: urlLocale, slug }),
    );
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveProperty(
      "value",
      "",
    );
    fireEvent.change(screen.getByPlaceholderText("slug"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith(
      "/src/routes/news.val.ts",
      "/news/hello",
    );
  });

  test("a language picked from the list goes into the URL", () => {
    const onSubmit = renderForm(
      route("/[[locale]]/news/[slug]", { locale: urlLocale, slug }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "nb" },
    });
    expect(screen.getByText("/nb")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("slug"), {
      target: { value: "hei" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith(
      "/src/routes/news.val.ts",
      "/nb/news/hei",
    );
  });

  test("a language the URL must have has to be chosen before Create is offered", () => {
    renderForm(
      route("/[locale]/news/[slug]", {
        locale: s.locale()["executeSerialize"](),
        slug,
      }),
    );
    fireEvent.change(screen.getByPlaceholderText("slug"), {
      target: { value: "hello" },
    });
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "nb-NO" },
    });
    expect(create).toHaveProperty("disabled", false);
  });

  test("each parameter's description is shown where it is entered", () => {
    renderForm(route("/[[locale]]/news/[slug]", { locale: urlLocale, slug }));
    expect(
      screen.getByText("Lower case letters, digits and hyphens"),
    ).toBeTruthy();
  });
});
