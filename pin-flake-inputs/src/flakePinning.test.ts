import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { extractPinnableInputs, pinFlakeInputs } from './flakePinning.js';
import { logger } from './logger.js';

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

describe('pinFlakeInputs', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'pin-flake-test-'));
    vi.spyOn(logger, 'info');
    vi.spyOn(logger, 'warn');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('does not log when input is already pinned', async () => {
    // Create a flake.lock with a pinned input
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
            rev: 'abc123def456',
            ref: 'nixos-unstable'
          },
          original: {
            ref: 'nixos-unstable'
          }
        }
      }
    };

    // Create a flake.nix that already has the input pinned
    const flakeNix = `{
  inputs = {
    # renovate: depName=NixOS/nixpkgs branch=nixos-unstable
    nixpkgs.url = "github:NixOS/nixpkgs/abc123def456";
  };
}`;

    await writeFile(join(testDir, 'flake.lock'), JSON.stringify(flakeLock, null, 2));
    await writeFile(join(testDir, 'flake.nix'), flakeNix);

    const result = await pinFlakeInputs(testDir);

    // Should return false (no changes made)
    expect(result).toBe(false);

    // Should not log "Pinned flake input"
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(0);
  });

  it('logs when input is pinned for the first time', async () => {
    // Create a flake.lock with an input
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
            rev: 'abc123def456',
            ref: 'nixos-unstable'
          },
          original: {
            ref: 'nixos-unstable'
          }
        }
      }
    };

    // Create a flake.nix that does NOT have the input pinned yet
    const flakeNix = `{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };
}`;

    await writeFile(join(testDir, 'flake.lock'), JSON.stringify(flakeLock, null, 2));
    await writeFile(join(testDir, 'flake.nix'), flakeNix);

    const result = await pinFlakeInputs(testDir);

    // Should return true (changes made)
    expect(result).toBe(true);

    // Should log "Pinned flake input"
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      { inputName: 'nixpkgs', rev: 'abc123def456' },
      'Pinned flake input'
    );
  });

  it('does not log when replacement results in no actual change', async () => {
    // Create a flake.lock with an input
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
            rev: 'abc123def456',
            ref: 'nixos-unstable'
          },
          original: {
            ref: 'nixos-unstable'
          }
        }
      }
    };

    // Create a flake.nix that already has the renovate comment and pinned URL
    // (this tests the case where isAlreadyPinned might fail but the replacement is idempotent)
    const flakeNix = `{
  inputs = {
    # renovate: depName=NixOS/nixpkgs branch=nixos-unstable
    nixpkgs.url = "github:NixOS/nixpkgs/abc123def456";
  };
}`;

    await writeFile(join(testDir, 'flake.lock'), JSON.stringify(flakeLock, null, 2));
    await writeFile(join(testDir, 'flake.nix'), flakeNix);

    const result = await pinFlakeInputs(testDir);

    // Should return false (no changes made)
    expect(result).toBe(false);

    // Should not log "Pinned flake input"
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(0);
  });

  it('does not log when input in block format is already pinned', async () => {
    // Create a flake.lock with a pinned input
    const flakeLock = {
      nodes: {
        root: {
          inputs: {
            dotfiles: 'dotfiles'
          }
        },
        dotfiles: {
          locked: {
            type: 'github',
            owner: 'nalabelle',
            repo: 'dotfiles',
            rev: '1ff3798f4b98e6db8f36ac9e975a4a1b4cc02959',
            ref: 'main'
          },
          original: {
            ref: 'main'
          }
        }
      }
    };

    // Create a flake.nix with block format that already has the input pinned
    const flakeNix = `{
  inputs = {
    dotfiles = {
      # renovate: depName=nalabelle/dotfiles branch=main
      url = "github:nalabelle/dotfiles/1ff3798f4b98e6db8f36ac9e975a4a1b4cc02959";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}`;

    await writeFile(join(testDir, 'flake.lock'), JSON.stringify(flakeLock, null, 2));
    await writeFile(join(testDir, 'flake.nix'), flakeNix);

    const result = await pinFlakeInputs(testDir);

    // Should return false (no changes made)
    expect(result).toBe(false);

    // Should not log "Pinned flake input"
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(0);
  });

  it('correctly pins multiple block-format inputs from real music flake', async () => {
    // Copy fixtures to test directory
    const fixturesDir = join(import.meta.dirname, 'fixtures', 'music-flake');
    const flakeLockContent = await readFile(join(fixturesDir, 'flake.lock'), 'utf8');
    const flakeNixContent = await readFile(join(fixturesDir, 'flake.nix'), 'utf8');
    const expectedContent = await readFile(join(fixturesDir, 'flake-expected.nix'), 'utf8');

    await writeFile(join(testDir, 'flake.lock'), flakeLockContent);
    await writeFile(join(testDir, 'flake.nix'), flakeNixContent);

    const result = await pinFlakeInputs(testDir);

    // Should return true (changes made)
    expect(result).toBe(true);

    // Read the updated flake.nix
    const updatedFlakeNix = await readFile(join(testDir, 'flake.nix'), 'utf8');

    // Should match expected output exactly
    expect(updatedFlakeNix).toBe(expectedContent);
  });
});
