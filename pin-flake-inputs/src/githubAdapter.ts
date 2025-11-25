import { PlatformAdapter, type PullRequestOptions } from './platformAdapter.js';
import { logger } from './logger.js';

/**
 * GitHub implementation of the PlatformAdapter.
 */
export class GitHubAdapter extends PlatformAdapter {
  public readonly platform = 'github' as const;

  public async findExistingPullRequest(
    repo: string,
    branchName: string,
    token: string
  ): Promise<number | null> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `https://api.github.com/repos/${owner}/${name}/pulls?state=open`;

    const response = await this.fetchWithTimeout(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json'
      },
      timeoutMs: 10_000
    });

    if (!response.ok) {
      return null;
    }

    const prs = (await response.json()) as {
      readonly head?: { readonly ref?: string };
      readonly number?: number;
      readonly id?: number;
    }[];

    for (const pr of prs) {
      if (pr.head?.ref === branchName) {
        return typeof pr.number === 'number' ? pr.number : pr.id ?? null;
      }
    }

    return null;
  }

  public async createPullRequest(
    options: PullRequestOptions,
    token: string
  ): Promise<number | null> {
    const { owner, name } = this.splitOwnerRepo(options.repo);
    const url = `https://api.github.com/repos/${owner}/${name}/pulls`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({
        title: options.title,
        head: options.branchName,
        base: options.defaultBranch,
        body: options.body
      }),
      timeoutMs: 30_000
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'GitHub PR creation failed or timed out'
      );
      return null;
    });

    if (!response?.ok) {
      return null;
    }

    const parsed = (await response.json()) as { readonly number?: number; readonly id?: number } | null;
    return parsed?.number ?? parsed?.id ?? null;
  }

  public async enableAutomerge(
    repo: string,
    prNumber: number,
    token: string
  ): Promise<void> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `https://api.github.com/repos/${owner}/${name}/pulls/${String(prNumber)}/merge`;

    const response = await this.fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({ merge_method: 'rebase' }),
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'GitHub merge API failed'
      );
      return null;
    });

    if (!response?.ok) {
      logger.warn(
        {
          repo,
          prNumber,
          status: response?.status !== undefined ? String(response.status) : 'no-response'
        },
        'GitHub merge API returned error'
      );
    }
  }

  public async closePullRequest(
    repo: string,
    prNumber: number,
    token: string
  ): Promise<void> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `https://api.github.com/repos/${owner}/${name}/pulls/${String(prNumber)}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({ state: 'closed' }),
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'GitHub PR close failed'
      );
      return null;
    });

    if (!response?.ok) {
      logger.warn(
        {
          repo,
          prNumber,
          status: response?.status !== undefined ? String(response.status) : 'no-response'
        },
        'GitHub close PR API returned error'
      );
    }
  }

  public async deleteBranch(
    repo: string,
    branchName: string,
    token: string
  ): Promise<void> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${branchName}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json'
      },
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { repo, branchName, error },
        'GitHub branch delete failed'
      );
      return null;
    });

    if (!response?.ok) {
      logger.warn(
        { repo, branchName, status: response?.status ?? 'no-response' },
        'GitHub delete branch API returned error'
      );
    }
  }
}
