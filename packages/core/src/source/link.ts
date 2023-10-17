import { VAL_EXTENSION } from ".";
export type LinkSource = {
  [VAL_EXTENSION]: "link";
  href: string;
};

export function link(href: string): LinkSource {
  return {
    [VAL_EXTENSION]: "link",
    href,
  };
}
