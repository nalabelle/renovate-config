import type { ProviderConfig } from './renovateProviderConfig.js';
import { PlatformAdapter, type PullRequestOptions } from './platformAdapter.js';

/**
 * Forgejo/Gitea implementation of the PlatformAdapter base class.
 *
 * The behaviour matches the original Bash script's use of the
 * /api/v1/repos/.../pulls and /pulls/{id}/merge endpoints.
 */
export class ForgejoAdapter extends PlatformAdapter {
  public readonly platform: ProviderConfig['platform'];

  private readonly endpoint: string;

  constructor(provider: ProviderConfig) {
    super();
    this.platform = provider.platform;
    this.endpoint = provider.endpoint.replace(/\/+$/, '');
  }

  public async findExistingPullRequest(
    repo: string,
    branchName: string,
    token: string
  ): Promise<number | null> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/pulls?state=open`;

    const response = await this.fetchWithTimeout(url, {
      headers: {
        Authorization: `token ${token}`
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
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/pulls`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
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
        `Warning: Forgejo PR creation failed or timed out: ${(error as Error).message}`
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
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/pulls/${prNumber}/merge`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        do: 'merge',
        merge_when_checks_succeed: true
      }),
      timeoutMs: 10_000
    }).catch(error => {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: Forgejo merge API failed: ${(error as Error).message}`
      );
      return null;
    });

    if (!response || !response.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: Forgejo merge API for ${repo} PR #${prNumber} returned ${
          response?.status ?? 'no-response'
        }`
      );
    }
  }
}
