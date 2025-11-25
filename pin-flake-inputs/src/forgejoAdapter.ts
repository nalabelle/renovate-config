import type { ProviderConfig } from './renovateProviderConfig.js';
import { PlatformAdapter, type PullRequestOptions } from './platformAdapter.js';
import { logger } from './logger.js';

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
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Forgejo PR creation failed or timed out'
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
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/pulls/${String(prNumber)}/merge`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        Do: 'merge',
        merge_when_checks_succeed: true,
        delete_branch_after_merge: true
      }),
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Forgejo merge API failed'
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
        'Forgejo merge API returned error'
      );
    }
  }

  public async closePullRequest(
    repo: string,
    prNumber: number,
    token: string
  ): Promise<void> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/pulls/${String(prNumber)}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ state: 'closed' }),
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Forgejo PR close failed'
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
        'Forgejo close PR API returned error'
      );
    }
  }

  public async branchExists(
    repo: string,
    branchName: string,
    token: string
  ): Promise<boolean> {
    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/branches/${branchName}`;

    const response = await this.fetchWithTimeout(url, {
      headers: {
        Authorization: `token ${token}`
      },
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.debug(
        { repo, branchName, error },
        'Forgejo branch existence check failed'
      );
      return null;
    });

    return response?.ok === true;
  }

  public async deleteBranch(
    repo: string,
    branchName: string,
    token: string
  ): Promise<void> {
    // Check if branch exists before attempting to delete
    const exists = await this.branchExists(repo, branchName, token);
    if (!exists) {
      logger.debug(
        { repo, branchName },
        'Branch does not exist on remote, skipping deletion'
      );
      return;
    }

    const { owner, name } = this.splitOwnerRepo(repo);
    const url = `${this.endpoint}/api/v1/repos/${owner}/${name}/branches/${branchName}`;

    const response = await this.fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${token}`
      },
      timeoutMs: 10_000
    }).catch((error: unknown) => {
      logger.warn(
        { repo, branchName, error },
        'Forgejo branch delete failed'
      );
      return null;
    });

    if (!response?.ok) {
      logger.warn(
        { repo, branchName, status: response?.status ?? 'no-response' },
        'Forgejo delete branch API returned error'
      );
    }
  }
}
