import { useEffect, useState } from "react";
import { Save, User } from "lucide-react";
import { cn } from "./designSystem/cn";
import { getInitials } from "../utils/getInitials";
import type { Profile } from "./ValProvider";

export type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "w-6 h-6 text-[0.625rem]",
  sm: "w-7 h-7 text-[0.6875rem]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

/**
 * The one way to render a person in this UI.
 *
 * There were five before: the shell's chrome drew initials only and never the
 * profile picture, the change history and the compare summary each drew their
 * own picture-or-initials variant, the draft changes list drew a third inline,
 * and an unused `ProfileImage` drew a fourth. So the same author looked like
 * two different people depending on which surface you were on - which is how
 * the picture came to be missing from the menus and present on the changes.
 *
 * The picture is layered OVER the initials rather than swapped in for them:
 * the shell should not wait on a network round-trip to draw its own chrome
 * (which is what the initials-only version was protecting against), and a
 * picture that 404s or never arrives leaves the initials showing rather than
 * an empty circle.
 */
export function Avatar({
  name,
  imageUrl,
  size = "md",
  className,
  fallback,
  label,
}: {
  /** Where the initials come from, and the accessible name unless `label` overrides it. */
  name: string | null;
  imageUrl?: string | null;
  size?: AvatarSize;
  className?: string;
  /**
   * What to draw when there is no name to take initials from - an anonymous or
   * filesystem-local author. Pass the colours it wants via `className`.
   */
  fallback?: React.ReactNode;
  /** The accessible name and hover title, when it is not just `name`. */
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  // A new URL deserves a new attempt: without this, one broken picture would
  // keep the initials showing after the profile was replaced by another.
  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  // `null` is "there is nobody here" and takes the fallback glyph; an empty
  // string is a profile that loaded WITHOUT a name, which is a person - so it
  // gets initials, and `getInitials` answers "?" for it rather than nothing.
  const initials = name === null ? null : getInitials(name);
  const showImage = !!imageUrl && !failed;
  // An empty name must not become an empty `aria-label`, and a `role="img"`
  // with no accessible name at all is worse than no role: without one the
  // initials are read as the ordinary text they are.
  const accessibleName = label ?? (name || undefined);

  return (
    <span
      role={accessibleName === undefined ? undefined : "img"}
      aria-label={accessibleName}
      title={accessibleName}
      className={cn(
        "relative grid place-items-center shrink-0 overflow-hidden rounded-full",
        "font-semibold select-none",
        "bg-bg-brand-primary text-fg-brand-primary",
        SIZE_CLASS[size],
        className,
      )}
    >
      {initials ?? fallback}
      {showImage && (
        <img
          src={imageUrl}
          // The wrapper carries the name (as `role="img"`, when there is one),
          // so a name here would be read out twice.
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/**
 * `Avatar` for a change's author, where "no author" is a real state.
 *
 * In `fs` mode there are no profiles at all and every change is the local
 * developer's, so an author-less change is "Local changes" rather than a
 * person Val failed to look up.
 */
export function ProfileAvatar({
  profile,
  mode,
  size = "xs",
  className,
}: {
  profile: Profile | null;
  mode: "fs" | "http" | "unknown";
  size?: AvatarSize;
  className?: string;
}) {
  if (!profile) {
    return (
      <Avatar
        name={null}
        size={size}
        label={mode === "fs" ? "Local changes" : "Unknown author"}
        fallback={
          mode === "fs" ? (
            <Save className="h-3 w-3" />
          ) : (
            <User className="h-3 w-3" />
          )
        }
        className={cn("bg-bg-secondary text-fg-disabled", className)}
      />
    );
  }
  return (
    <Avatar
      name={profile.fullName}
      imageUrl={profile.avatar?.url}
      size={size}
      className={className}
    />
  );
}
