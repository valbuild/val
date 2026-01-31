import { useState } from "react";
import { cn } from "./designSystem/cn";

export function AuthorAvatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="w-8 h-8 rounded-full bg-bg-brand-primary text-fg-brand-primary flex items-center justify-center text-xs font-semibold"
      title={name}
    >
      {initials || name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function AuthorAvatarGroup({ authors }: { authors: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const uniqueAuthors = Array.from(new Set(authors));
  const displayAuthors = uniqueAuthors.slice(0, 3);
  const remainingCount = uniqueAuthors.length - 3;

  return (
    <div className="relative">
      <div className="flex items-center -space-x-2">
        {displayAuthors.map((author, index) => (
          <div
            key={index}
            className="relative ring-2 ring-bg-secondary rounded-full"
            style={{ zIndex: displayAuthors.length - index }}
          >
            <AuthorAvatar name={author} />
          </div>
        ))}
        {remainingCount > 0 && (
          <div
            className="w-8 h-8 rounded-full bg-bg-tertiary text-fg-secondary flex items-center justify-center text-xs font-semibold ring-2 ring-bg-secondary cursor-pointer hover:bg-bg-secondary transition-colors"
            title={`${remainingCount} more author${remainingCount !== 1 ? "s" : ""}`}
            onClick={() => setShowAll(!showAll)}
          >
            +{remainingCount}
          </div>
        )}
      </div>

      {showAll && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setShowAll(false)}
          />
          <div className="absolute right-0 top-10 z-50 bg-bg-primary border border-border-primary rounded-lg shadow-lg p-3 min-w-[200px]">
            <div className="text-xs font-semibold text-fg-secondary mb-2 uppercase tracking-wide">
              All Authors ({uniqueAuthors.length})
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {uniqueAuthors.map((author, index) => (
                <div key={index} className="flex items-center gap-2">
                  <AuthorAvatar name={author} />
                  <span className="text-sm text-fg-primary">{author}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
