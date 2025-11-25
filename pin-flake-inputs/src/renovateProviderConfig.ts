import { readFile } from 'node:fs/promises';

/**
 * Minimal provider-level configuration needed to talk to the forge (GitHub / Forgejo / Gitea).
 *
 * This is intentionally derived from Renovate's config.js (or whatever file
 * RENOVATE_CONFIG_FILE points to) rather than from the resolved config
 * because platform/endpoint are not surfaced there.
 */

export type ProviderPlatform = 'github' | 'forgejo' | 'gitea';

export interface ProviderConfig {
  readonly platform: ProviderPlatform;
  readonly endpoint: string;
}

/**
 * Extract a simple string value from Renovate's "config.js"-style file.
 *
 * Despite the `.js` extension, Renovate's config in this repo is *not*
 * a normal JS module (it’s a bare object literal with comments and
 * trailing commas), so it cannot be safely `import()`ed or `require()`d.
 *
 * Rather than executing arbitrary configuration code, we treat the file
 * as JSON-ish text and pull out just the fields we care about with a
 * small, explicit parser. This keeps evaluation under our control and
 * avoids depending on the exact module shape Renovate uses internally.
 *
 * The format we expect is a line of the form:
 *
 *   "key": "value",
 *
 * with arbitrary indentation.
 */
function extractStringField(source: string, fieldName: string): string {
  const pattern = new RegExp(`^\\s*"${fieldName}"\\s*:\\s*"([^"]+)"`, 'm');
  const match = pattern.exec(source);

  if (!match?.[1]) {
    throw new Error(`Could not extract "${fieldName}" from provider config`);
  }

  return match[1];
}

/**
 * Load the provider configuration (platform and endpoint) that Renovate
 * uses when talking to the forge.
 *
 * The path defaults to RENOVATE_CONFIG_FILE if set, otherwise ./config.js.
 */
export async function loadProviderConfig(
  configPath: string = process.env['RENOVATE_CONFIG_FILE'] ?? 'config.js'
): Promise<ProviderConfig> {
  const raw = await readFile(configPath, 'utf8');

  const platformStr = extractStringField(raw, 'platform');
  if (platformStr !== 'github' && platformStr !== 'forgejo' && platformStr !== 'gitea') {
    throw new Error(`Unsupported platform: ${platformStr}`);
  }
  const platform: ProviderPlatform = platformStr;
  const endpoint = extractStringField(raw, 'endpoint');

  return {
    platform,
    endpoint
  };
}
