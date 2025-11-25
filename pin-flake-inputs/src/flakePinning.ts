import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';

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
    readonly type?: string;
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
  readonly originalType: string | undefined;
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
      // Skip if required fields are missing
      if (!locked.owner || !locked.repo) {
        continue;
      }
      pinned = {
        name: inputName,
        type,
        rev,
        owner: locked.owner,
        repo: locked.repo,
        host: type === 'gitlab' ? (locked.host ?? 'gitlab.com') : undefined,
        url: undefined,
        originalUrl: undefined,
        originalType: original?.type,
        originalRef: original?.ref ?? locked.ref
      };
    } else if (type === 'git') {
      // Skip if required url field is missing
      if (!locked.url) {
        continue;
      }
      pinned = {
        name: inputName,
        type,
        rev,
        owner: undefined,
        repo: undefined,
        host: undefined,
        url: locked.url,
        originalUrl: original?.url,
        originalType: original?.type,
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
    if (!input.owner || !input.repo) {
      throw new Error(`GitHub input ${input.name} missing owner or repo`);
    }
    parts.push(`depName=${input.owner}/${input.repo}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
  } else if (input.type === 'gitlab') {
    if (!input.owner || !input.repo || !input.host) {
      throw new Error(`GitLab input ${input.name} missing owner, repo, or host`);
    }
    parts.push(`depName=${input.owner}/${input.repo}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
    parts.push(`host=${input.host}`);
  } else if (input.type === 'git') {
    // Use originalUrl if available, otherwise fall back to locked url
    let url = input.originalUrl ?? input.url;
    if (!url) {
      throw new Error(`Git input ${input.name} missing url`);
    }
    // Add git+ prefix if original type is 'git' and URL starts with https:// or http://
    if (input.originalType === 'git' && (url.startsWith('https://') || url.startsWith('http://')) && !url.startsWith('git+')) {
      url = `git+${url}`;
    }
    parts.push(`url=${url}`);
    if (input.originalRef) {
      parts.push(`branch=${input.originalRef}`);
    }
  }

  // Use plain comment without 'renovate:' prefix to avoid confusing Renovate's native Nix manager
  // This preserves human-readable information while letting the native manager handle updates
  return `${indent}# ${parts.join(' ')}`;
}

/**
 * Build the pinned URL for an input
 */
function buildPinnedUrl(input: PinnedInput): string {
  if (input.type === 'github') {
    if (!input.owner || !input.repo) {
      throw new Error(`GitHub input ${input.name} missing owner or repo`);
    }
    return `github:${input.owner}/${input.repo}/${input.rev}`;
  } else if (input.type === 'gitlab') {
    if (!input.owner || !input.repo) {
      throw new Error(`GitLab input ${input.name} missing owner or repo`);
    }
    return `gitlab:${input.owner}/${input.repo}/${input.rev}`;
  } else if (input.type === 'git') {
    // Use originalUrl if available, otherwise fall back to locked.url
    let baseUrl = input.originalUrl ?? input.url;
    if (!baseUrl) {
      throw new Error(`Git input ${input.name} missing url`);
    }
    // Add git+ prefix if original type is 'git' and URL starts with https:// or http://
    if (input.originalType === 'git' && (baseUrl.startsWith('https://') || baseUrl.startsWith('http://')) && !baseUrl.startsWith('git+')) {
      baseUrl = `git+${baseUrl}`;
    }
    // Remove any existing query parameters before adding rev
    const cleanUrl = baseUrl.split('?')[0];
    if (!cleanUrl) {
      throw new Error(`Git input ${input.name} has invalid url`);
    }
    return `${cleanUrl}?rev=${input.rev}`;
  }
  throw new Error(`Unsupported input type: ${input.type}`);
}

/**
 * Escape a string for use in a regular expression
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build regex pattern for matching a block-format input
 * Matches: inputName = { ... };
 */
function buildBlockPattern(inputName: string): string {
  const escaped = escapeRegex(inputName);
  return `${escaped}\\s*=\\s*\\{[\\s\\S]*?^\\s*\\};`;
}

/**
 * Check if an input is already pinned in flake.nix
 */
function isAlreadyPinned(flakeNixContent: string, input: PinnedInput): boolean {
  const pinnedUrl = buildPinnedUrl(input);
  const escapedUrl = escapeRegex(pinnedUrl);
  const escapedInputName = escapeRegex(input.name);

  // Check for both simple format (inputName.url = "...") and block format (inputName = { url = "..." })
  const simplePattern = new RegExp(`${escapedInputName}\\.url\\s*=\\s*"${escapedUrl}"`);
  // For block format, check if the pinned URL appears anywhere in the input's block
  const blockPattern = new RegExp(
    `${escapedInputName}\\s*=\\s*\\{[\\s\\S]*?url\\s*=\\s*"${escapedUrl}"[\\s\\S]*?\\};`,
    'm'
  );

  return simplePattern.test(flakeNixContent) || blockPattern.test(flakeNixContent);
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

  // Fix any existing 'renovate:' prefixes in comments
  // This prevents Renovate's native Nix manager from getting confused
  // TODO: Remove this migration code after 2025-12-02
  const migrationDeadline = new Date('2025-12-02T00:00:00Z');
  if (new Date() > migrationDeadline) {
    throw new Error(
      'Migration code for renovate: prefix removal has expired. ' +
      'Please remove this code block from pinFlakeInputs function.'
    );
  }
  const beforeFix = flakeNixContent;
  flakeNixContent = flakeNixContent.replace(/^(\s*#\s*)renovate:\s+/gm, '$1');
  if (flakeNixContent !== beforeFix) {
    hasChanges = true;
    logger.info('Fixed existing renovate: prefixes in comments');
  }

  for (const input of pinnableInputs) {
    if (isAlreadyPinned(flakeNixContent, input)) {
      continue;
    }

    // Find the current URL line for this input - handle both formats:
    // 1. Simple: inputName.url = "...";
    // 2. Block:  inputName = { url = "..."; ... };
    // IMPORTANT: Create new RegExp objects for each input to avoid state issues
    const escapedInputName = escapeRegex(input.name);
    const simplePattern = new RegExp(`^(\\s*)${escapedInputName}\\.url\\s*=.*$`, 'gm');
    // For block format, match the entire block including closing brace
    const blockPattern = new RegExp(`^(\\s*)${buildBlockPattern(input.name)}`, 'gm');

    let match = simplePattern.exec(flakeNixContent);
    let isBlockFormat = false;

    if (!match) {
      // Try block format
      match = blockPattern.exec(flakeNixContent);
      isBlockFormat = true;
    }

    if (!match) {
      logger.warn({ inputName: input.name }, 'Input not found in flake.nix, skipping');
      continue;
    }

    const indent = match[1] ?? '';
    const pinnedUrl = buildPinnedUrl(input);
    const beforeContent = flakeNixContent;

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
        // Use the match index to replace at the exact position
        const matchIndex = match.index;
        flakeNixContent =
          flakeNixContent.slice(0, matchIndex) +
          newBlockContent +
          flakeNixContent.slice(matchIndex + blockContent.length);
      }
    } else {
      // For simple format, use match index for precise replacement
      const renovateComment = buildRenovateComment(input, indent);
      const replacement = `${renovateComment}\n${indent}${input.name}.url = "${pinnedUrl}";`;
      const matchIndex = match.index;
      const matchedLine = match[0];
      flakeNixContent =
        flakeNixContent.slice(0, matchIndex) +
        replacement +
        flakeNixContent.slice(matchIndex + matchedLine.length);
    }

    // Only log and mark as changed if content actually changed
    if (flakeNixContent !== beforeContent) {
      hasChanges = true;
      logger.info({ inputName: input.name, rev: input.rev }, 'Pinned flake input');
    }
  }

  if (hasChanges) {
    await writeFile(flakeNixPath, flakeNixContent, 'utf8');
  }

  return hasChanges;
}
