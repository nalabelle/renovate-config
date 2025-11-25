import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { Cron } from 'croner';
import { logger } from './logger.js';
import { loadProviderConfig } from './renovateProviderConfig.js';
import { extractResolvedConfig, loadRepoConfig } from './renovateRepoConfig.js';
import {
  cloneRepo,
  commitFlakeNix,
  configureGitIdentity,
  getDefaultBranch,
  hasDiffAgainstDefault,
  hasFlakeNixChanges,
  hasFlakeNix,
  makeRepoWorkdir,
  pushBranch
} from './gitOperations.js';
import { pinFlakeInputs } from './flakePinning.js';
import { ForgejoAdapter } from './forgejoAdapter.js';
import { GitHubAdapter } from './githubAdapter.js';
import { PlatformAdapter, type PullRequestOptions } from './platformAdapter.js';

export type ExitCode = 0 | 1 | 2;

async function execLenient(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(command, args, { cwd: options.cwd, env: options.env }, (error, so, se) => {
        if (error) {
          // Include stdout/stderr in the error for debugging
          const enrichedError = new Error(error.message, { cause: error });
          Object.assign(enrichedError, {
            stdout: so,
            stderr: se
          });
          reject(enrichedError);
          return;
        }
        resolve({ stdout: so, stderr: se });
      });
      child.stdin?.end();
    });

    return { stdout, stderr };
  } catch (error) {
    // Check if this is an expected error that we shouldn't log
    const isExpectedBranchError =
      command === 'git' &&
      args[0] === 'rev-parse' &&
      args[1] === '--verify' &&
      error instanceof Error &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.includes('Needed a single revision');

    // git diff --quiet returns exit code 1 when there ARE differences (expected)
    const isExpectedDiffResult =
      command === 'git' &&
      args[0] === 'diff' &&
      args[1] === '--quiet';

    if (!isExpectedBranchError && !isExpectedDiffResult) {
      logger.debug({ error, command, args }, 'Command execution failed');
    }
    return null;
  }
}

/**
 * Check if current time matches a cron-style schedule.
 *
 * Supports cron format and the special value "at any time".
 * Uses croner library for proper cron parsing and matching.
 */
function matchesSchedule(schedule: string): boolean {
  // If schedule is "at any time", always match
  if (schedule === 'at any time') {
    return true;
  }

  try {
    // Parse the cron schedule
    const cron = new Cron(schedule, { legacyMode: false });

    // Get the next scheduled run
    const nextRun = cron.nextRun();
    if (!nextRun) {
      // Invalid schedule, default to allowing
      return true;
    }

    const now = new Date();
    const next = new Date(nextRun);

    // Check if we're in the same hour, day, and month as the next run
    // This matches Renovate's behavior of running during the scheduled window
    return (
      next.getHours() === now.getHours() &&
      next.getDate() === now.getDate() &&
      next.getMonth() === now.getMonth()
    );
  } catch {
    // If parsing fails, default to allowing (same as Renovate)
    return true;
  }
}

/**
 * Discover repositories using Renovate's autodiscovery.
 */
async function discoverRepos(): Promise<string[]> {
  const tempDir = await mkdtemp(join(tmpdir(), 'update-flake-locks-discover-'));
  const reposFile = join(tempDir, 'repos.json');

  logger.debug({ tempDir, reposFile }, 'Starting repository discovery');

  try {
    const result = await execLenient(
      'renovate',
      [
        '--autodiscover',
        `--write-discovered-repos=${reposFile}`
      ],
      { env: process.env }
    );

    if (!result) {
      logger.error('renovate --autodiscover command failed');
      logger.error('Ensure RENOVATE_TOKEN and RENOVATE_CONFIG_FILE are set correctly');
      return [];
    }

    logger.debug({ stdout: result.stdout, stderr: result.stderr }, 'renovate command output');

    const raw = await readFile(reposFile, 'utf8');
    const parsed = JSON.parse(raw) as readonly string[];
    const repos = parsed.map(repo => repo.trim()).filter(Boolean);

    logger.info({ count: repos.length }, 'Discovered repositories');
    return repos;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createAdapter(platform: string, endpoint: string): PlatformAdapter {
  if (platform === 'github') {
    return new GitHubAdapter();
  }

  if (platform === 'forgejo' || platform === 'gitea') {
    return new ForgejoAdapter({ platform, endpoint });
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Core implementation for updating a single repository. This wires together:
 * - Renovate repo config
 * - Provider config (platform/endpoint)
 * - Git/Nix operations
 * - Platform adapter (GitHub / Forgejo)
 */
async function updateRepo(repo: string, dryRun: boolean): Promise<ExitCode> {
  // eslint-disable-next-line no-console
  console.log(`=== Processing ${repo} ===`);

  const repoConfig = await loadRepoConfig(repo);

  if (!repoConfig.nixEnabled) {
    // eslint-disable-next-line no-console
    console.log(`⊘ Nix manager disabled in ${repo}, skipping`);
    return 2;
  }

  const provider = await loadProviderConfig();
  const adapter = createAdapter(provider.platform, provider.endpoint);

  if (!matchesSchedule(repoConfig.schedule)) {
    // eslint-disable-next-line no-console
    console.log(`⊘ Outside schedule for ${repo}, skipping`);
    return 2;
  }

  const token = process.env['RENOVATE_TOKEN'] ?? '';
  if (!token) {
    // eslint-disable-next-line no-console
    console.error('ERROR: RENOVATE_TOKEN is not set');
    return 1;
  }

  const repoDir = makeRepoWorkdir(repo);

  if (!(await cloneRepo(provider.endpoint, repo, repoDir))) {
    // eslint-disable-next-line no-console
    console.error(`✗ Failed to clone ${repo}`);
    return 1;
  }

  if (!hasFlakeNix(repoDir)) {
    // eslint-disable-next-line no-console
    console.log(`⊘ No flake.nix in ${repo}, skipping`);
    return 2;
  }

  await configureGitIdentity(repoDir, repoConfig.gitAuthor, token);

  const defaultBranch = await getDefaultBranch(repoDir);
  if (!defaultBranch) {
    // eslint-disable-next-line no-console
    console.error(`✗ Failed to determine default branch for ${repo}`);
    return 1;
  }

  const branchName = `${repoConfig.branchPrefix}pin-flake-inputs`;

  logger.info('Pinning flake inputs from flake.lock...');
  if (!(await pinFlakeInputs(repoDir))) {
    logger.info({ repo }, 'No inputs to pin or already pinned');

    // Check if there's an existing open PR that should be closed since inputs are already pinned
    const existing = await adapter.findExistingPullRequest(repo, branchName, token);
    if (existing != null) {
      logger.info({ repo, prNumber: existing, branchName, defaultBranch }, 'Closing PR since inputs are already pinned on default branch');
      await adapter.closePullRequest(repo, existing, token);
    }

    // Delete the branch if it exists on the remote since inputs are already pinned on default branch
    // The adapter will check if the branch exists before attempting deletion
    logger.info({ repo, branchName, defaultBranch }, 'Deleting branch since inputs are already pinned on default branch');
    await adapter.deleteBranch(repo, branchName, token);

    return 2;
  }

  if (!(await hasFlakeNixChanges(repoDir))) {
    // eslint-disable-next-line no-console
    console.log(`○ No changes to flake.nix in ${repo}`);
    return 2;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(`Creating test branch ${branchName}...`);

    if (!(await ensureBranchAndCommit(repoDir, branchName))) {
      // eslint-disable-next-line no-console
      console.error(`✗ Failed to prepare branch in ${repo}`);
      return 1;
    }

    // Show the diff
    const diffResult = await execLenient('git', ['diff', `origin/${defaultBranch}`, '--', 'flake.nix'], { cwd: repoDir });
    if (diffResult?.stdout.trim()) {
      // eslint-disable-next-line no-console
      console.log('\nChanges to flake.nix:');
      // eslint-disable-next-line no-console
      console.log(diffResult.stdout);
    }

    const diffVsDefault = await hasDiffAgainstDefault(repoDir, defaultBranch);
    if (!diffVsDefault) {
      // eslint-disable-next-line no-console
      console.log(
        `DRY-RUN: No changes compared to ${defaultBranch}, would not push or create PR`
      );
      return 2;
    }

    // eslint-disable-next-line no-console
    console.log(`DRY-RUN: Changes detected, would push to origin/${branchName}`);
    if (repoConfig.automerge) {
      // eslint-disable-next-line no-console
      console.log(`DRY-RUN: Would create PR in ${repo} (automerge enabled)`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`DRY-RUN: Would create PR in ${repo} (automerge disabled)`);
    }

    return 0;
  }

  if (!(await ensureBranchAndCommit(repoDir, branchName))) {
    // eslint-disable-next-line no-console
    console.error(`✗ Failed to prepare branch in ${repo}`);
    return 1;
  }

  // Check if there are changes compared to the default branch
  if (!(await hasDiffAgainstDefault(repoDir, defaultBranch))) {
    // eslint-disable-next-line no-console
    console.log(`○ No changes compared to ${defaultBranch} in ${repo}`);
    return 2;
  }

  // Check if the remote branch already exists with the same changes
  const remoteBranchCheck = await execLenient('git', ['rev-parse', '--verify', `origin/${branchName}`], { cwd: repoDir });
  if (remoteBranchCheck) {
    logger.debug({ repo, branchName }, 'Remote branch exists, checking for differences');
    const diffVsRemoteBranch = await execLenient('git', ['diff', '--quiet', `origin/${branchName}`], { cwd: repoDir });
    if (diffVsRemoteBranch) {
      // No diff means the remote branch already has these exact changes
      logger.info({ repo, branchName }, 'Remote branch already has these changes');
      return 2;
    }
  } else {
    logger.debug({ repo, branchName }, 'Remote branch does not exist, will create new branch');
  }

  // eslint-disable-next-line no-console
  console.log(`Pushing branch ${branchName}...`);
  if (!(await pushBranch(repoDir, branchName))) {
    // eslint-disable-next-line no-console
    console.error('ERROR: Git push failed');
    return 1;
  }
  // eslint-disable-next-line no-console
  console.log('Push complete');

  // eslint-disable-next-line no-console
  console.log('Checking/creating PR...');

  const existing = await adapter.findExistingPullRequest(repo, branchName, token);
  if (existing != null) {
    logger.info({ repo, prNumber: existing }, 'Updated repository with existing PR');
    if (repoConfig.automerge) {
      await adapter.enableAutomerge(repo, existing, token);
    }
    return 0;
  }

  const prOptions: PullRequestOptions = {
    repo,
    branchName,
    defaultBranch,
    title: 'chore(deps): pin flake inputs',
    body:
      'Pin Nix flake inputs to specific commits from flake.lock.\n\n' +
      'This enables Renovate to track and update them properly.\n\n' +
      'After this PR is merged, Renovate will create update PRs when new versions are available.'
  };

  const prNumber = await adapter.createPullRequest(prOptions, token);
  if (prNumber == null) {
    // eslint-disable-next-line no-console
    console.error('⚠ Pushed repo but failed to create PR (continuing anyway)');
    return 0;
  }

  if (repoConfig.automerge) {
    await adapter.enableAutomerge(repo, prNumber, token);
    // eslint-disable-next-line no-console
    console.log('✓ Updated repo and created PR with automerge enabled');
  } else {
    // eslint-disable-next-line no-console
    console.log('✓ Updated repo and created PR');
  }

  return 0;
}

async function ensureBranchAndCommit(repoDir: string, branchName: string): Promise<boolean> {
  const checkout = await execLenient('git', ['checkout', '-B', branchName], { cwd: repoDir });
  if (!checkout) {
    return false;
  }

  if (!(await commitFlakeNix(repoDir))) {
    return false;
  }

  return true;
}

async function runExtractConfig(input: string, output: string): Promise<void> {
  const raw = await readFile(input, 'utf8');
  const extracted = extractResolvedConfig(raw);
  await rm(output, { force: true }).catch(() => {
    // Ignore errors when removing file
  });
  await writeFile(output, extracted, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Extracted config to ${output}`);
}

async function runDiscover(): Promise<void> {
  const repos = await discoverRepos();
  for (const repo of repos) {
    // eslint-disable-next-line no-console
    console.log(repo);
  }
}

async function runBatchUpdate(repos: string[], dryRun: boolean): Promise<ExitCode> {
  let success = 0;
  let skip = 0;
  let fail = 0;

  for (const repo of repos) {
    const result = await updateRepo(repo, dryRun);
    switch (result) {
      case 0:
        success += 1;
        break;
      case 1:
        fail += 1;
        break;
      case 2:
        skip += 1;
        break;
      default:
        break;
    }
    logger.debug('Completed repository processing');
  }

  logger.info(
    { total: repos.length, success, skip, fail },
    'Batch update summary'
  );

  return fail > 0 ? 1 : 0;
}

/**
 * Commander-based CLI entrypoint.
 */
export async function main(argv: string[]): Promise<ExitCode> {
  const program = new Command();

  program
    .name('pin-flake-inputs')
    .description('Pin flake inputs to commits from flake.lock across Renovate-discovered repositories')
    .version('0.0.0');

  program
    .command('extract-config')
    .argument('<input>', 'input file containing renovate --print-config output')
    .argument('<output>', 'output file for extracted JSON config')
    .action(async (input: string, output: string) => {
      await runExtractConfig(input, output);
    });

  program
    .command('discover')
    .description('Print autodiscovered repositories, one per line')
    .action(async () => {
      await runDiscover();
    });

  program
    .argument('[repos...]', 'repositories to update (owner/name). If omitted, use Renovate autodiscovery.')
    .option('--dry-run', 'run without pushing or creating PRs', false)
    .action(async (repos: string[], options: { dryRun?: boolean }) => {
      let targetRepos = repos;

      if (targetRepos.length === 0) {
        // eslint-disable-next-line no-console
        console.log('Discovering repositories...');
        targetRepos = await discoverRepos();
        if (targetRepos.length === 0) {
          // eslint-disable-next-line no-console
          console.log('No repositories discovered');
          process.exitCode = 0;
          return;
        }
        logger.info({ count: targetRepos.length }, 'Discovered repositories');
      } else {
        // eslint-disable-next-line no-console
        console.log('Using provided repositories:');
        for (const repo of targetRepos) {
          // eslint-disable-next-line no-console
          console.log(repo);
        }
        // eslint-disable-next-line no-console
        console.log('');
      }

      if (options.dryRun) {
        // eslint-disable-next-line no-console
        console.log('Running in DRY-RUN mode');
        // eslint-disable-next-line no-console
        console.log('');
      }

      const code = await runBatchUpdate(targetRepos, options.dryRun === true);
      process.exitCode = code;
    });

  await program.parseAsync(['node', 'pin-flake-inputs', ...argv]);
  return (process.exitCode ?? 0) as ExitCode;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  void main(process.argv.slice(2));
}
