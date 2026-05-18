import { SourcePath } from "@valbuild/core";
import { useState } from "react";
import classNames from "classnames";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Copy,
  File,
  GitCompare,
  History,
  Minus,
  Pencil,
  Plus,
  Save,
  User,
} from "lucide-react";
import { PendingPatch, Profile, useValMode } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { ScrollArea } from "./designSystem/scroll-area";
import { Button } from "./designSystem/button";
import { getInitials } from "../utils/getInitials";
import { relativeLocalDate } from "../utils/relativeLocalDate";

function OpIcon({ op }: { op: string }) {
  const size = 12;
  if (op === "add") return <Plus size={size} />;
  if (op === "remove") return <Minus size={size} />;
  if (op === "replace") return <GitCompare size={size} />;
  if (op === "move") return <ArrowRightLeft size={size} />;
  if (op === "copy") return <Copy size={size} />;
  if (op === "file") return <File size={size} />;
  return <Pencil size={size} />;
}

function AuthorAvatar({
  profile,
  isFirst,
  stacked,
  mode,
}: {
  profile: Profile | null;
  isFirst: boolean;
  stacked: boolean;
  mode: "fs" | "http" | "unknown";
}) {
  const baseClass = classNames(
    "flex-shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-semibold overflow-hidden",
    { "-ml-2": stacked && !isFirst },
  );

  if (!profile) {
    return (
      <span
        className={classNames(baseClass, "bg-bg-secondary text-fg-disabled")}
      >
        {mode === "fs" ? <Save size={12} /> : <User size={12} />}
      </span>
    );
  }

  if (profile.avatar?.url) {
    return (
      <img
        src={profile.avatar.url}
        alt={profile.fullName}
        className={classNames(baseClass, "object-cover")}
      />
    );
  }

  const initials = getInitials(profile.fullName);
  return (
    <span
      className={classNames(
        baseClass,
        "bg-bg-brand-primary text-fg-brand-primary",
      )}
    >
      {initials}
    </span>
  );
}

export type AuthorPatchInfo = {
  createdAt: string;
  opType: string;
};

function getOpType(patch: PendingPatch | AuthorPatchInfo): string {
  if ("opType" in patch) {
    return patch.opType;
  }
  if (patch.patch.length > 0) {
    return patch.patch[0].op;
  }
  return "replace";
}

function getMostRecentCreatedAt(
  patchesByAuthorIds: Record<string, (PendingPatch | AuthorPatchInfo)[]>,
): string {
  const allPatches = Object.values(patchesByAuthorIds).flat();
  return allPatches.reduce(
    (latest, patch) =>
      new Date(patch.createdAt) > new Date(latest) ? patch.createdAt : latest,
    allPatches[0].createdAt,
  );
}

export function PatchAuthorsSummary({
  patchesByAuthorIds,
  profilesByAuthorIds,
  now,
  mode,
  showHistoryIcon,
}: {
  patchesByAuthorIds: Record<string, (PendingPatch | AuthorPatchInfo)[]>;
  profilesByAuthorIds: Record<string, Profile>;
  now: Date;
  mode: "fs" | "http" | "unknown";
  showHistoryIcon?: boolean;
}) {
  const authorIds = Object.keys(patchesByAuthorIds);
  if (authorIds.length === 0) return null;

  const visibleAuthorIds = authorIds.slice(0, 3);
  const overflowCount = authorIds.length - visibleAuthorIds.length;
  const mostRecentCreatedAt = getMostRecentCreatedAt(patchesByAuthorIds);

  return (
    <>
      {showHistoryIcon && (
        <History size={12} className="text-fg-tertiary mr-0.5" />
      )}
      <span className="text-xs text-fg-tertiary mr-1">
        {relativeLocalDate(now, mostRecentCreatedAt)}
      </span>
      <span className="flex items-center rounded-full">
        {visibleAuthorIds.map((authorId, i) => (
          <AuthorAvatar
            key={authorId}
            profile={profilesByAuthorIds[authorId] ?? null}
            isFirst={i === 0}
            stacked={authorIds.length > 1}
            mode={mode}
          />
        ))}
        {overflowCount > 0 && (
          <span className="flex-shrink-0 -ml-2 w-6 h-6 text-xs font-semibold rounded-full inline-flex items-center justify-center bg-bg-primary text-fg-primary border border-border-primary">
            +{overflowCount}
          </span>
        )}
      </span>
    </>
  );
}

export function FieldPatchAuthorsPure({
  patchesByAuthorIds,
  profilesByAuthorIds,
  now,
  portalContainer,
  mode,
}: {
  patchesByAuthorIds: Record<string, (PendingPatch | AuthorPatchInfo)[]>;
  profilesByAuthorIds: Record<string, Profile>;
  now: Date;
  portalContainer: HTMLElement | null;
  mode: "fs" | "http" | "unknown";
}) {
  const authorIds = Object.keys(patchesByAuthorIds);
  if (authorIds.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label="Change history">
          <PatchAuthorsSummary
            patchesByAuthorIds={patchesByAuthorIds}
            profilesByAuthorIds={profilesByAuthorIds}
            now={now}
            mode={mode}
            showHistoryIcon
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="z-[9001] min-w-[220px] p-0"
      >
        <div className="px-3 pt-2.5 pb-1.5 text-xs font-medium text-fg-secondary border-b border-border-primary flex items-center gap-1.5">
          <History size={12} />
          <span>Change history</span>
        </div>
        <ScrollArea className="h-40">
          <div className="flex flex-col gap-3 p-3">
            {authorIds.map((authorId) => {
              const profile = profilesByAuthorIds[authorId] ?? null;
              const authorName =
                profile?.fullName ??
                (mode === "fs" ? "Local changes" : "Unknown author");
              const patches = [...patchesByAuthorIds[authorId]].sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() -
                  new Date(a.createdAt).getTime(),
              );
              return (
                <div key={authorId} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-semibold text-xs text-fg-secondary">
                    <AuthorAvatar
                      profile={profile}
                      isFirst={true}
                      stacked={false}
                      mode={mode}
                    />
                    <span>{authorName}</span>
                  </div>
                  <div className="flex flex-col gap-0 pl-8">
                    {patches.map((patch, i) => {
                      const op = getOpType(patch);
                      const isLast = i === patches.length - 1;
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs text-fg-tertiary"
                        >
                          <span className="relative flex items-center justify-center w-3 h-5">
                            {!isLast && (
                              <span className="absolute top-1/2 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border-secondary" />
                            )}
                            {i > 0 && (
                              <span className="absolute top-0 bottom-1/2 left-1/2 w-px -translate-x-1/2 bg-border-secondary" />
                            )}
                            <span className="relative text-fg-secondary">
                              <OpIcon op={op} />
                            </span>
                          </span>
                          <span>{relativeLocalDate(now, patch.createdAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function FieldPatchAuthors({
  patchesByAuthorIds,
  profilesByAuthorIds,
  sourcePath,
  navigable = true,
}: {
  patchesByAuthorIds: Record<string, (PendingPatch | AuthorPatchInfo)[]>;
  profilesByAuthorIds: Record<string, Profile>;
  sourcePath?: SourcePath;
  navigable?: boolean;
}) {
  const [now] = useState(() => new Date());
  const mode = useValMode();
  const { navigate } = useNavigation();

  const authorIds = Object.keys(patchesByAuthorIds);
  if (authorIds.length === 0) return null;

  const onNavigateToCompare =
    navigable && sourcePath
      ? () => navigate("/val/compare", { scrollToId: `compare-${sourcePath}` })
      : undefined;

  if (!onNavigateToCompare) {
    return (
      <span className="inline-flex items-center text-xs">
        <PatchAuthorsSummary
          patchesByAuthorIds={patchesByAuthorIds}
          profilesByAuthorIds={profilesByAuthorIds}
          now={now}
          mode={mode}
        />
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label="View in compare"
      onClick={onNavigateToCompare}
    >
      <PatchAuthorsSummary
        patchesByAuthorIds={patchesByAuthorIds}
        profilesByAuthorIds={profilesByAuthorIds}
        now={now}
        mode={mode}
      />
      <ArrowUpRight size={12} className="ml-1 text-fg-tertiary" />
    </Button>
  );
}
