import { COMMIT_SHA, firstLine, git, type Repo } from "./repo.ts";

/** The recorded base of a review that read the whole repo, not a diff from a base. It cannot be a commit ID. */
export const WHOLE_REPO = "all";

function reviewedKey(branch: string): string {
  return `branch.${branch}.coherence-reviewed`;
}

function reviewedBaseKey(branch: string): string {
  return `${reviewedKey(branch)}-base`;
}

// `git config --unset-all` exits 5 when the key was never set, which leaves the same result.
const CONFIG_KEY_ABSENT = 5;

// Kept in the repo's own git config, so it stays per clone and per branch and needs no file of ours.
// Earlier versions stored "true" for the whole branch; that is not a commit, so it counts as never reviewed.
export async function reviewedCommit(repo: Repo, branch: string): Promise<string | undefined> {
  const stored = (await git(["config", "--get", reviewedKey(branch)], repo.root)).stdout.trim();
  return COMMIT_SHA.test(stored) ? stored : undefined;
}

/**
 * What the branch's recorded review was made against: a commit ID, WHOLE_REPO, or undefined when the base is missing or not
 * one of those. Missing includes approvals left by earlier versions, which wrote only the head and so cannot say what they covered.
 */
export async function reviewedBase(repo: Repo, branch: string): Promise<string | typeof WHOLE_REPO | undefined> {
  const stored = (await git(["config", "--get", reviewedBaseKey(branch)], repo.root)).stdout.trim();
  return stored === WHOLE_REPO || COMMIT_SHA.test(stored) ? stored : undefined;
}

/** Records that commit `headId` was reviewed, and the base it was reviewed against, or the whole repo when there is none, as one review. */
export async function markCommitReviewed(repo: Repo, branch: string, headId: string, baseId?: string): Promise<void> {
  // The head is what the gate honours, so the old one goes first and the new one is written last: any failure leaves no approval.
  await revokeReview(repo, branch);
  await setConfig(repo, ["config", reviewedBaseKey(branch), baseId ?? WHOLE_REPO]);
  await setConfig(repo, ["config", reviewedKey(branch), headId]);
}

/** Forgets the branch's recorded review, head before base. */
export async function revokeReview(repo: Repo, branch: string): Promise<void> {
  for (const key of [reviewedKey(branch), reviewedBaseKey(branch)]) {
    // --unset-all, because plain --unset fails on a key with several values with the same code as on an absent key.
    const result = await git(["config", "--unset-all", key], repo.root);
    if (result.code !== 0 && result.code !== CONFIG_KEY_ABSENT) throw new Error(`git config failed: ${firstLine(result.stderr)}`);
  }
}

async function setConfig(repo: Repo, args: string[]): Promise<void> {
  const result = await git(args, repo.root);
  if (result.code !== 0) throw new Error(`git config failed: ${firstLine(result.stderr)}`);
}
