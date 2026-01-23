import { useEffect, useState } from "react";
import { Profile } from "./ValProvider";
import classNames from "classnames";

export function ProfileImage({
  profile,
  size = "md",
}: {
  profile: Profile;
  size?: "sm" | "md" | "lg";
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(
    profile?.avatar?.url || null
  );
  useEffect(() => {
    if (profile?.avatar?.url) {
      setImageUrl(profile?.avatar?.url);
    } else {
      setImageUrl(null);
    }
  }, [profile]);

  const [firstName, ...tail] = profile.fullName?.split(" ") || [""];
  const lastName = tail[tail.length - 1] || "";
  const initials = `${firstName[0].toUpperCase()}${lastName[0].toUpperCase()}`;
  const className = classNames(
    `rounded-full text-center inline-block bg-bg-brand-primary text-fg-brand-primary`,
    {
      "h-8 w-8 leading-8 text-xs": size === "sm",
      "h-10 w-10 leading-10 text-base": size === "md",
      "h-12 w-12 leading-[3rem] text-lg": size === "lg",
    }
  );
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={initials}
        className={className}
        onError={() => {
          setImageUrl(null);
        }}
      />
    );
  }
  return <span className={className}>{initials}</span>;
}
