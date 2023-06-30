declare const brand: unique symbol;

type Brand<T, TBrand> = T & { [brand]: TBrand };

export type OrgName = Brand<string, "OrgName">;
export type ProjectName = Brand<string, "ProjectName">;

export type ValRoot = Brand<string, "ValRoot">;
export type GitRef = Brand<string, "GitRef">; // e.g. "heads/master" or "1234567890abcdef1234567890abcdef12345678"
export type BranchRef = Brand<string, "BranchRef">;
export type CommitSha = Brand<string, "CommitSha">;
