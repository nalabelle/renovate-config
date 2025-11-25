import { describe, expect, it, vi, afterEach } from 'vitest';

import { type ProviderConfig, loadProviderConfig } from './renovateProviderConfig.js';

vi.mock('node:fs/promises', async actualImport => {
  const actual = await actualImport<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn()
  };
});

const readFileMock = vi.mocked(
  (await import('node:fs/promises')).readFile
);

describe('loadProviderConfig', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('parses platform and endpoint from config text', async () => {
    const fakeConfig = `
    {
      // some comment
      "platform": "forgejo",
      "endpoint": "https://git.example.test",
      "other": "ignored"
    }
    `;

    readFileMock.mockResolvedValue(fakeConfig);

    const cfg = await loadProviderConfig('/fake/path/config.js');

    const typed: ProviderConfig = cfg;

    expect(typed.platform).toBe('forgejo');
    expect(typed.endpoint).toBe('https://git.example.test');
    expect(readFileMock).toHaveBeenCalledWith('/fake/path/config.js', 'utf8');
  });

  it('throws if platform is missing', async () => {
    const fakeConfig = `
    {
      "endpoint": "https://git.example.test"
    }
    `;

    readFileMock.mockResolvedValue(fakeConfig);

    await expect(loadProviderConfig('/fake/path/config.js')).rejects.toThrow(
      'Could not extract "platform" from provider config'
    );
  });

  it('throws if endpoint is missing', async () => {
    const fakeConfig = `
    {
      "platform": "github"
    }
    `;

    readFileMock.mockResolvedValue(fakeConfig);

    await expect(loadProviderConfig('/fake/path/config.js')).rejects.toThrow(
      'Could not extract "endpoint" from provider config'
    );
  });
});
