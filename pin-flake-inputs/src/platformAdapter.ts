import type { ProviderPlatform } from './renovateProviderConfig.js';

/**
 * Common options for creating a pull request.
 */
export interface PullRequestOptions {
  readonly repo: string;
  readonly branchName: string;
  readonly defaultBranch: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Abstract base class for forge adapters (GitHub, Forgejo, etc.).
 *
 * Concrete subclasses:
 *   - GitHubAdapter (in ./githubAdapter.ts)
 *   - ForgejoAdapter (in ./forgejoAdapter.ts)
 *
 * This class provides shared helpers and defines the contract that all
 * adapters must follow.
 */
export abstract class PlatformAdapter {
  public abstract readonly platform: ProviderPlatform;

  /**
   * Find an existing PR whose head branch matches the given name.
   * Returns the PR number (or id) if found, otherwise null.
   */
  public abstract findExistingPullRequest(
    repo: string,
    branchName: string,
    token: string
  ): Promise<number | null>;

  /**
   * Create a pull request from a prepared branch.
   * Returns the PR number (or id) if creation succeeds, otherwise null.
   */
  public abstract createPullRequest(
    options: PullRequestOptions,
    token: string
  ): Promise<number | null>;

  /**
   * Enable automerge / auto-merge-like behaviour on a PR if the platform
   * supports it. This is intentionally best-effort.
   */
  public abstract enableAutomerge(
    repo: string,
    prNumber: number,
    token: string
  ): Promise<void>;

  /**
   * Shared HTTP helper for platform adapters: a thin wrapper around fetch
   * with a hard timeout.
   *
   * Subclasses can call this protected helper instead of re-implementing
   * the timeout logic.
   */
  protected async fetchWithTimeout(
    url: string,
    init: RequestInit & { readonly timeoutMs?: number } = {}
  ): Promise<Response> {
    const { timeoutMs = 10_000, ...rest } = init;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...rest, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Helper to split a "owner/name" repo string into its components.
   */
  protected splitOwnerRepo(repo: string): { owner: string; name: string } {
    const [owner, name] = repo.split('/', 2);
    if (!owner || !name) {
      throw new Error(`Invalid repo identifier: ${repo}`);
    }
    return { owner, name };
  }
}
