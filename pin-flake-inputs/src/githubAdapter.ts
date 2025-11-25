import { PlatformAdapter, type PullRequestOptions } from './platformAdapter.js';

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

    const prs = (await response.json()) as Array<{
      readonly head?: { readonly ref?: string };
      readonly number?: number;
      readonly id?: number;
    }>;

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
    }).catch(error => {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: GitHub PR creation failed or timed out: ${(error as Error).message}`
      );
      return null;
    });

    if (!response || !response.ok) {
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
    const url = `https://api.github.com/repos/${owner}/${name}/pulls/${prNumber}/merge`;

    const response = await this.fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json'
      },
      body: JSON.stringify({ merge_method: 'rebase' }),
      timeoutMs: 10_000
    }).catch(error => {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: GitHub merge API failed: ${(error as Error).message}`
      );
      return null;
    });

    if (!response || !response.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: GitHub merge API for ${repo} PR #${prNumber} returned ${
          response?.status ?? 'no-response'
        }`
      );
    }
  }
}
