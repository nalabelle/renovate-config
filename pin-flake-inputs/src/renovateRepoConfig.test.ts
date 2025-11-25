import { describe, expect, it } from 'vitest';
import { extractResolvedConfig } from './renovateRepoConfig.js';

describe('extractResolvedConfig', () => {
  it('extracts JSON block between Full resolved config and next INFO marker', () => {
    const raw = [
      ' INFO: Something else',
      ' INFO: Full resolved config (merged from all sources)',
      '"config": {',
      '  "nix": { "enabled": true },',
      '  "gitAuthor": "Renovate Bot <bot@example.com>"',
      '}',
      ' INFO: Another log line'
    ].join('\n');

    const extracted = extractResolvedConfig(raw);

    const parsed = JSON.parse(extracted) as {
      readonly config?: {
        readonly nix?: {
          readonly enabled?: boolean;
        };
        readonly gitAuthor?: string;
      };
    };

    expect(parsed.config?.nix?.enabled).toBe(true);
    expect(parsed.config?.gitAuthor).toBe('Renovate Bot <bot@example.com>');
  });

  it('uses end of output when there is no later INFO marker', () => {
    const raw = [
      ' INFO: Preamble',
      ' INFO: Full resolved config',
      '"config": {',
      '  "branchPrefix": "renovate/"',
      '}'
    ].join('\n');

    const extracted = extractResolvedConfig(raw);

    const parsed = JSON.parse(extracted) as {
      readonly config?: {
        readonly branchPrefix?: string;
      };
    };

    expect(parsed.config?.branchPrefix).toBe('renovate/');
  });

  it('throws if Full resolved config marker is missing', () => {
    const raw = [' INFO: something', '"config": {}'].join('\n');

    expect(() => extractResolvedConfig(raw)).toThrow(
      'Could not find "Full resolved config" marker in renovate output'
    );
  });

  it('throws if extracted section is empty', () => {
    const raw = [' INFO: Full resolved config', ' INFO: Done'].join('\n');

    expect(() => extractResolvedConfig(raw)).toThrow('Extracted config section is empty');
  });
});
