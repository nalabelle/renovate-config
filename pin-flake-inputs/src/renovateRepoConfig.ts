import { execFile } from 'node:child_process';

export interface RepoRenovateConfig {
  readonly nixEnabled: boolean;
  readonly gitAuthor: string;
  readonly branchPrefix: string;
  readonly lockfileBranch: string;
  readonly schedule: string;
  readonly automerge: boolean;
}

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface RenovateResolvedConfigRaw {
  readonly config?: {
    readonly nix?: {
      readonly enabled?: boolean;
    };
    readonly gitAuthor?: string;
    readonly branchPrefix?: string;
    readonly lockFileMaintenance?: {
      readonly branchTopic?: string;
      readonly automerge?: boolean;
    };
    readonly schedule?: readonly string[];
  };
}

/**
 * Execute a subprocess and capture stdout/stderr as UTF-8 strings.
 *
 * Throws if the command exits non‑zero or times out.
 */
async function execChecked(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs?: number } = {}
): Promise<ExecResult> {
  const { timeoutMs = 60_000 } = options;

  return new Promise<ExecResult>((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
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
 * Extract the JSON payload printed by `renovate --print-config`.
 *
 * This is a small, self-contained copy of the logic used previously in main.ts.
 */
export function extractResolvedConfig(rawOutput: string): string {
  const lines = rawOutput.split(/\r?\n/);

  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith(' INFO: Full resolved config')) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    throw new Error('Could not find "Full resolved config" marker in renovate output');
  }

  let endIndex = -1;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith(' INFO:')) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    endIndex = lines.length;
  }

  const slice = lines.slice(startIndex + 1, endIndex);
  const joined = slice.join('\n').trim();

  if (!joined) {
    throw new Error('Extracted config section is empty');
  }

  return `{${joined}\n}`;
}

/**
 * Call Renovate and obtain the resolved config JSON for a given repo.
 */
async function getResolvedConfigRaw(repo: string): Promise<RenovateResolvedConfigRaw> {
  const result = await execChecked('renovate', [
    '--dry-run',
    '--autodiscover=false',
    '--print-config=true',
    repo
  ]);

  const combinedOutput = `${result.stdout}${result.stderr}`;
  const jsonText = extractResolvedConfig(combinedOutput);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Failed to parse resolved Renovate config JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Resolved Renovate config is not an object');
  }

  return parsed as RenovateResolvedConfigRaw;
}

/**
 * Load the subset of Renovate's resolved configuration that we need
 * for operating on a single repository.
 */
export async function loadRepoConfig(repo: string): Promise<RepoRenovateConfig> {
  const raw = await getResolvedConfigRaw(repo);

  const cfg = raw.config ?? {};

  return {
    nixEnabled: cfg.nix?.enabled === true,
    gitAuthor: cfg.gitAuthor ?? '',
    branchPrefix: cfg.branchPrefix ?? '',
    lockfileBranch: cfg.lockFileMaintenance?.branchTopic ?? '',
    schedule: cfg.schedule?.[0] ?? 'at any time',
    automerge: cfg.lockFileMaintenance?.automerge === true
  };
}
