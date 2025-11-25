import { describe, expect, it } from 'vitest';
import { extractPinnableInputs } from './flakePinning.js';

describe('extractPinnableInputs', () => {
  it('extracts github inputs correctly', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            nixpkgs: 'nixpkgs'
          }
        },
        nixpkgs: {
          locked: {
            type: 'github',
            owner: 'NixOS',
            repo: 'nixpkgs',
            rev: 'abc123',
            ref: 'nixos-unstable'
          },
          original: {
            ref: 'nixos-unstable'
          }
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      name: 'nixpkgs',
      type: 'github',
      rev: 'abc123',
      owner: 'NixOS',
      repo: 'nixpkgs',
      host: undefined,
      url: undefined,
      originalUrl: undefined,
      originalRef: 'nixos-unstable'
    });
  });

  it('extracts gitlab inputs correctly', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            myproject: 'myproject'
          }
        },
        myproject: {
          locked: {
            type: 'gitlab',
            owner: 'myorg',
            repo: 'myproject',
            rev: 'def456',
            host: 'gitlab.example.com',
            ref: 'main'
          },
          original: {
            ref: 'main'
          }
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      name: 'myproject',
      type: 'gitlab',
      rev: 'def456',
      owner: 'myorg',
      repo: 'myproject',
      host: 'gitlab.example.com',
      url: undefined,
      originalUrl: undefined,
      originalRef: 'main'
    });
  });

  it('extracts git inputs with git+ prefix preserved', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            'resume-builder': 'resume-builder'
          }
        },
        'resume-builder': {
          locked: {
            type: 'git',
            url: 'https://git.oops.city/nalabelle/resume-builder',
            rev: '13c526850bb3c1d46742c5a978c6e9148d567ce8',
            ref: 'refs/heads/main'
          },
          original: {
            type: 'git',
            url: 'git+https://git.oops.city/nalabelle/resume-builder',
            ref: 'refs/heads/main'
          }
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      name: 'resume-builder',
      type: 'git',
      rev: '13c526850bb3c1d46742c5a978c6e9148d567ce8',
      owner: undefined,
      repo: undefined,
      host: undefined,
      url: 'https://git.oops.city/nalabelle/resume-builder',
      originalUrl: 'git+https://git.oops.city/nalabelle/resume-builder',
      originalRef: 'refs/heads/main'
    });
  });

  it('skips inputs without locked section', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            nixpkgs: 'nixpkgs',
            follows: 'follows'
          }
        },
        nixpkgs: {
          locked: {
            type: 'github',
            owner: 'NixOS',
            repo: 'nixpkgs',
            rev: 'abc123'
          }
        },
        follows: {
          // No locked section - this is a follows reference
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.name).toBe('nixpkgs');
  });

  it('skips inputs without rev', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            nixpkgs: 'nixpkgs'
          }
        },
        nixpkgs: {
          locked: {
            type: 'github',
            owner: 'NixOS',
            repo: 'nixpkgs'
            // Missing rev
          }
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(0);
  });

  it('skips unsupported input types', () => {
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            tarball: 'tarball'
          }
        },
        tarball: {
          locked: {
            type: 'tarball',
            url: 'https://example.com/archive.tar.gz',
            rev: 'abc123'
          }
        }
      }
    };

    const inputs = extractPinnableInputs(flakeLock);

    expect(inputs).toHaveLength(0);
  });
});
