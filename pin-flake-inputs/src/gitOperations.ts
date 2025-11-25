import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitContext {
  readonly repo: string;
  readonly repoDir: string;
  readonly defaultBranch: string;
  readonly branchName: string;
}

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Execute a subprocess and capture stdout/stderr as UTF-8 strings.
 *
 * Throws if the command exits non‑zero.
 */
async function execChecked(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = execFile(command, args, { cwd: options.cwd, env: options.env }, (error, stdout, stderr) => {
      if (error) {
        const enriched = new Error(
          `Command failed: ${command} ${args.join(' ')}\n${stderr || stdout}`,
          { cause: error }
        );
        reject(enriched);
        return;
      }

      resolve({
        stdout: String(stdout),
        stderr: String(stderr)
      });
    });

    child.stdin?.end();
  });
}

/**
 * Execute a subprocess, but never throw. Returns null on non-zero exit.
 */
async function execLenient(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
): Promise<ExecResult | null> {
  try {
    return await execChecked(command, args, options);
  } catch {
    return null;
  }
}

/**
 * Compute a temporary working directory for a given repo identifier.
 */
export function makeRepoWorkdir(repo: string): string {
  return join(tmpdir(), `flake-update-${repo.replace(/\//g, '-')}`);
}

/**
 * Clone a repository from the given endpoint into a temp directory.
 * If the directory already exists and is a valid git repo, fetch and reset instead of re-cloning.
 */
export async function cloneRepo(endpoint: string, repo: string, repoDir: string): Promise<boolean> {
  // Check if directory exists and is a git repo
  if (existsSync(join(repoDir, '.git'))) {
    // Try to reuse existing clone by fetching and resetting
    const fetch = await execLenient('git', ['fetch', '--all'], { cwd: repoDir });
    if (fetch) {
      const reset = await execLenient('git', ['reset', '--hard', 'origin/HEAD'], { cwd: repoDir });
      const clean = await execLenient('git', ['clean', '-fdx'], { cwd: repoDir });
      if (reset && clean) {
        return true;
      }
    }
    // If reuse failed, clean up and fall through to fresh clone
    await rm(repoDir, { recursive: true, force: true });
  }

  const result = await execLenient('git', ['clone', `${endpoint}/${repo}`, repoDir]);
  return result !== null;
}

/**
 * Ensure the repository contains a flake.nix.
 */
export function hasFlakeNix(repoDir: string): boolean {
  return existsSync(join(repoDir, 'flake.nix'));
}

/**
 * Configure git identity and credential helper to use the Renovate token.
 */
export async function configureGitIdentity(
  repoDir: string,
  gitAuthor: string,
  token: string
): Promise<void> {
  const namePart = gitAuthor.replace(/\s*<.*$/, '');
  const emailMatch = gitAuthor.match(/<([^>]+)>/);
  const email = emailMatch?.[1] ?? '';

  await execLenient('git', ['config', 'user.name', namePart], { cwd: repoDir });
  await execLenient('git', ['config', 'user.email', email], { cwd: repoDir });

  const helperScript = `!f() { echo "username=renovate"; echo "password=${token}"; }; f`;
  await execLenient('git', ['config', 'credential.helper', helperScript], { cwd: repoDir });
}

/**
 * Determine the default branch name from origin/HEAD.
 */
export async function getDefaultBranch(repoDir: string): Promise<string | null> {
  const originHead = await execLenient('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd: repoDir
  });

  if (!originHead) {
    return null;
  }

  return originHead.stdout.trim().replace(/^refs\/remotes\/origin\//, '');
}

/**
 * Run `nix flake update` in the repo.
 */
export async function updateFlakeLock(repoDir: string): Promise<boolean> {
  const result = await execLenient('nix', ['flake', 'update'], { cwd: repoDir });
  return result !== null;
}

/**
 * Check if flake.nix has any changes.
 */
export async function hasFlakeNixChanges(repoDir: string): Promise<boolean> {
  const diffOutput = await execLenient('git', ['diff', '--', 'flake.nix'], { cwd: repoDir });
  return !!diffOutput && diffOutput.stdout.trim() !== '';
}

/**
 * Commit flake.nix changes with pinned inputs.
 */
export async function commitFlakeNix(repoDir: string): Promise<boolean> {
  await execLenient('git', ['add', 'flake.nix'], { cwd: repoDir });

  const result = await execLenient(
    'git',
    [
      'commit',
      '-m',
      'chore(deps): pin flake inputs',
      '-m',
      'Pin Nix flake inputs to specific commits from flake.lock.\n\nThis enables Renovate to track and update them properly.'
    ],
    { cwd: repoDir }
  );

  return result !== null;
}

/**
 * Create or reset the working branch.
 */
export async function ensureBranch(repoDir: string, branchName: string): Promise<boolean> {
  const result = await execLenient('git', ['checkout', '-B', branchName], { cwd: repoDir });
  return result !== null;
}

/**
 * Compare the current branch against the default branch.
 */
export async function hasDiffAgainstDefault(
  repoDir: string,
  defaultBranch: string
): Promise<boolean> {
  const result = await execLenient('git', ['diff', '--quiet', `origin/${defaultBranch}`], {
    cwd: repoDir
  });

  // git diff --quiet exits with 0 when there are NO changes, 1 when there ARE changes
  // execLenient returns non-null on success (exit 0), null on failure (exit 1)
  // So we return true (has diff) when result is null (command failed = has changes)
  return result === null;
}

/**
 * Push the working branch forcefully to origin.
 */
export async function pushBranch(repoDir: string, branchName: string): Promise<boolean> {
  const result = await execLenient('git', ['push', '-f', 'origin', branchName], {
    cwd: repoDir,
    env: process.env
  });
  return result !== null;
}

/**
 * Convenience helper: read flake.lock content (useful for debugging / testing).
 */
export async function readFlakeLock(repoDir: string): Promise<string> {
  return readFile(join(repoDir, 'flake.lock'), 'utf8');
}
