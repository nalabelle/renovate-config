import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from './githubAdapter.js';

describe('GitHubAdapter', () => {
  let adapter: GitHubAdapter;
  const mockToken = 'test-token';
  const mockRepo = 'owner/repo';

  beforeEach(() => {
    adapter = new GitHubAdapter();
  });

  describe('branchExists', () => {
    it('returns true when branch exists', async () => {
      const mockResponse = {
        ok: true,
        json: () => Promise.resolve({ ref: 'refs/heads/renovate/pin-flake-inputs' })
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const exists = await adapter.branchExists(mockRepo, 'renovate/pin-flake-inputs', mockToken);

      expect(exists).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/git/refs/heads/renovate/pin-flake-inputs',
        expect.objectContaining({
          headers: {
            Authorization: `token ${mockToken}`,
            Accept: 'application/vnd.github+json'
          }
        }) as RequestInit
      );
    });

    it('returns false when branch does not exist (404)', async () => {
      const mockResponse = {
        ok: false,
        status: 404
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const exists = await adapter.branchExists(mockRepo, 'non-existent-branch', mockToken);

      expect(exists).toBe(false);
    });

    it('returns false when API call fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const exists = await adapter.branchExists(mockRepo, 'some-branch', mockToken);

      expect(exists).toBe(false);
    });

    it('returns false when API returns non-404 error', async () => {
      const mockResponse = {
        ok: false,
        status: 500
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const exists = await adapter.branchExists(mockRepo, 'some-branch', mockToken);

      expect(exists).toBe(false);
    });
  });

  describe('deleteBranch', () => {
    it('does not call API when branch does not exist', async () => {
      // Mock branchExists to return false
      vi.spyOn(adapter, 'branchExists').mockResolvedValue(false);

      const deleteFetch = vi.fn();
      global.fetch = deleteFetch;

      await adapter.deleteBranch(mockRepo, 'non-existent-branch', mockToken);

      // Should not attempt to delete
      expect(deleteFetch).not.toHaveBeenCalled();
    });

    it('calls API when branch exists', async () => {
      // Mock branchExists to return true
      vi.spyOn(adapter, 'branchExists').mockResolvedValue(true);

      const mockResponse = {
        ok: true
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await adapter.deleteBranch(mockRepo, 'existing-branch', mockToken);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/git/refs/heads/existing-branch',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            Authorization: `token ${mockToken}`,
            Accept: 'application/vnd.github+json'
          }
        }) as RequestInit
      );
    });
  });
});
