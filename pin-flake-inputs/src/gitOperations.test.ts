import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cloneRepo, getDefaultBranch, hasFlakeNix, makeRepoWorkdir } from './gitOperations.js';

const execAsync = promisify(execFile);

describe('gitOperations', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'git-ops-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('makeRepoWorkdir', () => {
    it('converts repo name to valid directory name', () => {
      const result = makeRepoWorkdir('owner/repo');
      expect(result).toContain('flake-update-owner-repo');
      // The result is a full path, so check that the repo name part has no slashes
      expect(result).toMatch(/flake-update-owner-repo$/);
    });
  });

  describe('hasFlakeNix', () => {
    it('returns false when flake.nix does not exist', () => {
      expect(hasFlakeNix(testDir)).toBe(false);
    });

    it('returns true when flake.nix exists', async () => {
      await writeFile(join(testDir, 'flake.nix'), '{}');
      expect(hasFlakeNix(testDir)).toBe(true);
    });
  });

  describe('getDefaultBranch', () => {
    it('returns null for non-git directory', async () => {
      const result = await getDefaultBranch(testDir);
      expect(result).toBeNull();
    });

    it('returns the default branch name from origin/HEAD', async () => {
      // Create a minimal git repo with a default branch
      await execAsync('git', ['init', '-b', 'main'], { cwd: testDir });
      await writeFile(join(testDir, 'test.txt'), 'test');
      await execAsync('git', ['add', 'test.txt'], { cwd: testDir });
      await execAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
      await execAsync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
      await execAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });

      // Create a bare clone to simulate a remote
      const bareDir = join(testDir, 'bare.git');
      await execAsync('git', ['clone', '--bare', testDir, bareDir]);

      // Clone from the bare repo
      const cloneDir = join(testDir, 'clone');
      await execAsync('git', ['clone', bareDir, cloneDir]);

      const result = await getDefaultBranch(cloneDir);
      expect(result).toBe('main');
    });
  });

  describe('cloneRepo', () => {
    let bareRepoDir: string;
    let endpoint: string;

    beforeEach(async () => {
      // Create a test repository with a default branch
      const sourceDir = join(testDir, 'source');
      await mkdir(sourceDir);
      await execAsync('git', ['init', '-b', 'main'], { cwd: sourceDir });
      await writeFile(join(sourceDir, 'flake.nix'), '{ description = "test"; }');
      await execAsync('git', ['add', 'flake.nix'], { cwd: sourceDir });
      await execAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceDir });
      await execAsync('git', ['config', 'user.name', 'Test User'], { cwd: sourceDir });
      await execAsync('git', ['commit', '-m', 'initial'], { cwd: sourceDir });

      // Create a bare repository to simulate a remote
      bareRepoDir = join(testDir, 'bare');
      await mkdir(bareRepoDir);
      await execAsync('git', ['clone', '--bare', sourceDir, bareRepoDir]);

      endpoint = testDir;
    });

    it('clones a repository successfully', async () => {
      const targetDir = join(testDir, 'clone1');
      const result = await cloneRepo(endpoint, 'bare', targetDir);

      expect(result).toBe(true);
      expect(hasFlakeNix(targetDir)).toBe(true);
    });

    it('reuses existing clone and resets to default branch', async () => {
      const targetDir = join(testDir, 'clone2');

      // First clone
      await cloneRepo(endpoint, 'bare', targetDir);

      // Create a test branch and check it out
      await execAsync('git', ['checkout', '-b', 'test-branch'], { cwd: targetDir });
      await writeFile(join(targetDir, 'test.txt'), 'modified');
      await execAsync('git', ['add', 'test.txt'], { cwd: targetDir });
      await execAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetDir });
      await execAsync('git', ['config', 'user.name', 'Test User'], { cwd: targetDir });
      await execAsync('git', ['commit', '-m', 'test commit'], { cwd: targetDir });

      // Verify we're on test-branch
      const { stdout: beforeBranch } = await execAsync('git', ['branch', '--show-current'], { cwd: targetDir });
      expect(beforeBranch.trim()).toBe('test-branch');

      // Second "clone" should reuse and reset
      const result = await cloneRepo(endpoint, 'bare', targetDir);

      expect(result).toBe(true);

      // Verify we're back on main branch
      const { stdout: afterBranch } = await execAsync('git', ['branch', '--show-current'], { cwd: targetDir });
      expect(afterBranch.trim()).toBe('main');

      // Verify working directory is clean
      const { stdout: status } = await execAsync('git', ['status', '--porcelain'], { cwd: targetDir });
      expect(status.trim()).toBe('');
    });

    it('handles repository with modified files by cleaning them', async () => {
      const targetDir = join(testDir, 'clone3');

      // First clone
      await cloneRepo(endpoint, 'bare', targetDir);

      // Modify a file without committing
      await writeFile(join(targetDir, 'flake.nix'), '{ description = "modified"; }');
      await writeFile(join(targetDir, 'untracked.txt'), 'untracked');

      // Second "clone" should clean everything
      const result = await cloneRepo(endpoint, 'bare', targetDir);

      expect(result).toBe(true);

      // Verify working directory is clean
      const { stdout: status } = await execAsync('git', ['status', '--porcelain'], { cwd: targetDir });
      expect(status.trim()).toBe('');

      // Verify flake.nix is back to original
      const content = await readFile(join(targetDir, 'flake.nix'), 'utf8');
      expect(content).toBe('{ description = "test"; }');
    });
  });
});
