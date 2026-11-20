import { Check, Link } from "lucide-react";
import { useState } from "react";
import { Button } from "../designSystem/button";
import { copyText } from "../../utils/copyText";
import { PeopleStack } from "./PeopleStack";
import type { ProposalParticipant } from "./types";

/**
 * Who is in a proposal's chat, and a link to it: the header of a shared chat
 * until the invite menu is wired (valbuild/home `docs/proposals.md`, Flow H).
 *
 * The link is the page as it is, which carries the chat (`?session=`), so
 * whoever opens it on the project lands in this conversation.
 */
export function ShareChatLink({
  people,
  getLink = () => window.location.href,
}: {
  people: ProposalParticipant[];
  /** For tests and stories: the real one is this page's address. */
  getLink?: () => string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(getLink());
    setCopied(true);
  };
  return (
    <span className="flex items-center gap-1">
      {people.length > 1 && <PeopleStack people={people} />}
      <Button
        variant="ghost"
        size="sm"
        onClick={copy}
        className="h-7 gap-1 px-2 text-xs touch:text-sm"
        title="Anyone on the project can open this chat"
      >
        {copied ? <Check className="h-3 w-3" /> : <Link className="h-3 w-3" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </span>
  );
}
