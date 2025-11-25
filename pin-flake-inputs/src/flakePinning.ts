import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Represents a flake input node from flake.lock
 */
interface FlakeLockNode {
  readonly locked?: {
    readonly type?: string;
    readonly rev?: string;
    readonly owner?: string;
    readonly repo?: string;
    readonly host?: string;
    readonly url?: string;
    readonly ref?: string;
  };
  readonly original?: {
    readonly ref?: string;
    readonly url?: string;
  };
}

/**
 * Represents the structure of flake.lock
 */
interface FlakeLock {
  readonly nodes: Record<string, FlakeLockNode> & {
    readonly root: {
      readonly inputs: Record<string, string>;
    };
  };
}

/**
 * Information about a pinned input
 */
interface PinnedInput {
  readonly name: string;
  readonly type: string;
  readonly rev: string;
  readonly owner: string | undefined;
  readonly repo: string | undefined;
  readonly host: string | undefined;
  readonly url: string | undefined;
  readonly originalUrl: string | undefined;
  readonly originalRef: string | undefined;
}

/**
 * Read and parse flake.lock
 */
export async function readFlakeLock(repoDir: string): Promise<FlakeLock> {
  const lockPath = join(repoDir, 'flake.lock');
  const content = await readFile(lockPath, 'utf8');
  return JSON.parse(content) as FlakeLock;
}

/**
 * Extract pinnable inputs from flake.lock
 */
export function extractPinnableInputs(flakeLock: FlakeLock): PinnedInput[] {
  const rootInputs = flakeLock.nodes.root.inputs;
  const pinnedInputs: PinnedInput[] = [];

  for (const [inputName, nodeRef] of Object.entries(rootInputs)) {
    const node = flakeLock.nodes[nodeRef];
    if (!node?.locked) {
      continue;
    }

    const { locked, original } = node;
    const { type, rev } = locked;

    if (!type || !rev) {
      continue;
    }

    let pinned: PinnedInput;

    if (type === 'github' || type === 'gitlab') {
      pinned = {
        name: inputName,
        type,
        rev,
        owner: locked.owner,
        repo: locked.repo,
        host: type === 'gitlab' ? (locked.host ?? 'gitlab.com') : undefined,
        url: undefined,
        originalUrl: undefined,
        originalRef: original?.ref ?? locked.ref
      };
    } else if (type === 'git') {
      pinned = {
        name: inputName,
        type,
        rev,
        owner: undefined,
        repo: undefined,
        host: undefined,
        url: locked.url,
        originalUrl: original?.url,
        originalRef: original?.ref ?? locked.ref
      };
    } else {
      continue;
    }

    pinnedInputs.push(pinned);
  }

  return pinnedInputs;
}

/**
 * Build the renovate comment for an input
 */
function buildRenovateComment(input: PinnedInput, indent: string): string {
  const parts: string[] = [];

  if (input.type === 'github') {
    parts.push(`depName=${input.owner}/${input.repo}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
  } else if (input.type === 'gitlab') {
    parts.push(`depName=${input.owner}/${input.repo}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
    parts.push(`host=${input.host}`);
  } else if (input.type === 'git') {
    parts.push(`url=${input.url}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
  }

  return `${indent}# renovate: ${parts.join(' ')}`;
}

/**
 * Build the pinned URL for an input
 */
function buildPinnedUrl(input: PinnedInput): string {
  if (input.type === 'github') {
    return `github:${input.owner}/${input.repo}/${input.rev}`;
  } else if (input.type === 'gitlab') {
    return `gitlab:${input.owner}/${input.repo}/${input.rev}`;
  } else if (input.type === 'git') {
    // Use originalUrl if available (preserves git+https:// prefix)
    // Otherwise fall back to locked.url
    const baseUrl = input.originalUrl ?? input.url;
    // Remove any existing query parameters before adding rev
    const cleanUrl = baseUrl?.split('?')[0];
    return `${cleanUrl}?rev=${input.rev}`;
  }
  throw new Error(`Unsupported input type: ${input.type}`);
}

/**
 * Check if an input is already pinned in flake.nix
 */
function isAlreadyPinned(flakeNixContent: string, input: PinnedInput): boolean {
  const pinnedUrl = buildPinnedUrl(input);
  const pattern = new RegExp(`${input.name}\\.url.*${pinnedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return pattern.test(flakeNixContent);
}

/**
 * Pin flake inputs in flake.nix based on commits from flake.lock
 */
export async function pinFlakeInputs(repoDir: string): Promise<boolean> {
  const flakeLock = await readFlakeLock(repoDir);
  const pinnableInputs = extractPinnableInputs(flakeLock);

  if (pinnableInputs.length === 0) {
    return false;
  }

  const flakeNixPath = join(repoDir, 'flake.nix');
  let flakeNixContent = await readFile(flakeNixPath, 'utf8');
  let hasChanges = false;

  for (const input of pinnableInputs) {
    if (isAlreadyPinned(flakeNixContent, input)) {
      continue;
    }

    // Find the current URL line for this input - handle both formats:
    // 1. Simple: inputName.url = "...";
    // 2. Block:  inputName = { url = "..."; ... };
    const simplePattern = new RegExp(`^(\\s*)${input.name}\\.url\\s*=.*$`, 'gm');
    const blockPattern = new RegExp(`^(\\s*)${input.name}\\s*=\\s*\\{[^}]*url\\s*=.*$`, 'gms');

    let match = simplePattern.exec(flakeNixContent);
    let isBlockFormat = false;

    if (!match) {
      // Try block format
      match = blockPattern.exec(flakeNixContent);
      isBlockFormat = true;
    }

    if (!match) {
      // eslint-disable-next-line no-console
      console.warn(`  ${input.name}: Warning: Not found in flake.nix, skipping`);
      continue;
    }

    const indent = match[1] ?? '';
    const pinnedUrl = buildPinnedUrl(input);

    if (isBlockFormat) {
      // For block format, find the url line and its indentation within the block
      const urlLinePattern = new RegExp(`(\\s*)(url\\s*=\\s*)"[^"]*";`, 'gm');
      const blockContent = match[0];
      const urlMatch = urlLinePattern.exec(blockContent);

      if (urlMatch) {
        const urlIndent = urlMatch[1] ?? '';
        const renovateComment = buildRenovateComment(input, urlIndent);
        // Don't add extra newline - the comment already ends with \n
        const urlReplacement = `${renovateComment}${urlIndent}url = "${pinnedUrl}";`;

        // Replace just the url line within the matched block
        const newBlockContent = blockContent.replace(urlLinePattern, urlReplacement);
        flakeNixContent = flakeNixContent.replace(blockContent, newBlockContent);
      }
    } else {
      // For simple format, replace the entire line
      const renovateComment = buildRenovateComment(input, indent);
      const replacement = `${renovateComment}\n${indent}${input.name}.url = "${pinnedUrl}";`;
      flakeNixContent = flakeNixContent.replace(simplePattern, replacement);
    }

    hasChanges = true;

    // eslint-disable-next-line no-console
    console.log(`  ${input.name}: Pinning to ${input.rev}`);
  }

  if (hasChanges) {
    await writeFile(flakeNixPath, flakeNixContent, 'utf8');
  }

  return hasChanges;
}
