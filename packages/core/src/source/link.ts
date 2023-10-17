import { VAL_EXTENSION } from ".";
export type LinkSource = {
  [VAL_EXTENSION]: "link";
  href: string;
  text?: string;
};

export function link({
  href,
  text,
}: Pick<LinkSource, "href" | "text">): LinkSource {
  return {
    [VAL_EXTENSION]: "link",
    href,
    ...(text !== undefined ? { text } : {}),
  };
}
