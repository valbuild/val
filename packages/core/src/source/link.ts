import { VAL_EXTENSION } from ".";
export type LinkSource = {
  [VAL_EXTENSION]: "link";
  href: string;
  children: [string];
};

export function link(text: string, { href }: { href: string }): LinkSource {
  return {
    [VAL_EXTENSION]: "link",
    href,
    children: [text],
  };
}
