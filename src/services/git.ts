import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { tmpdir } from 'os';

export interface CloneOptions {
  branch?: string;
  depth?: number;
  recursive?: boolean;
  targetDir?: string;
}

export interface CloneResult {
  success: boolean;
  localPath?: string;
  error?: string;
}

export class GitService {
  private static readonly DEFAULT_CLONE_DIR = path.join(tmpdir(), 'forge-repos');

  /**
   * Clone a Git repository to a local directory
   */
  static async cloneRepository(
    repoUrl: string, 
    options: CloneOptions = {}
  ): Promise<CloneResult> {
    try {
      const {
        branch = 'main',
        depth = 1,
        recursive = false,
        targetDir
      } = options;

      // Ensure clone directory exists
      await fs.ensureDir(this.DEFAULT_CLONE_DIR);

      // Generate unique directory name
      const repoName = this.extractRepoName(repoUrl);
      const timestamp = Date.now();
      const cloneDir = targetDir || path.join(
        this.DEFAULT_CLONE_DIR, 
        `${repoName}-${timestamp}`
      );

      console.log(chalk.cyan(`Cloning repository: ${repoUrl}`));
      console.log(chalk.gray(`Target directory: ${cloneDir}`));

      // Build git clone command
      const gitArgs = [
        'clone',
        '--single-branch',
        '--branch', branch,
        '--depth', depth.toString()
      ];

      if (recursive) {
        gitArgs.push('--recursive');
      }

      gitArgs.push(repoUrl, cloneDir);

      // Execute git clone
      execSync(`git ${gitArgs.join(' ')}`, {
        stdio: 'pipe',
        encoding: 'utf8'
      });

      console.log(chalk.green('Repository cloned successfully'));
      
      return {
        success: true,
        localPath: cloneDir
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Failed to clone repository: ${errorMessage}`));
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Update an existing cloned repository
   */
  static async updateRepository(localPath: string, branch: string = 'main'): Promise<CloneResult> {
    try {
      if (!await fs.pathExists(localPath)) {
        throw new Error(`Repository path does not exist: ${localPath}`);
      }

      console.log(chalk.cyan(`Updating repository at: ${localPath}`));

      // Fetch latest changes
      execSync('git fetch origin', {
        cwd: localPath,
        stdio: 'pipe'
      });

      // Reset to latest commit on the specified branch
      execSync(`git reset --hard origin/${branch}`, {
        cwd: localPath,
        stdio: 'pipe'
      });

      console.log(chalk.green('Repository updated successfully'));

      return {
        success: true,
        localPath
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Failed to update repository: ${errorMessage}`));
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Clean up old cloned repositories
   */
  static async cleanupOldRepositories(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      if (!await fs.pathExists(this.DEFAULT_CLONE_DIR)) {
        return;
      }

      const entries = await fs.readdir(this.DEFAULT_CLONE_DIR, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(this.DEFAULT_CLONE_DIR, entry.name);
          const stats = await fs.stat(dirPath);
          
          if (now - stats.mtime.getTime() > maxAge) {
            console.log(chalk.gray(`Cleaning up old repository: ${entry.name}`));
            await fs.remove(dirPath);
          }
        }
      }
    } catch (error) {
      console.warn(chalk.yellow(`Failed to cleanup old repositories: ${error}`));
    }
  }

  /**
   * Check if a directory is a valid git repository
   */
  static async isGitRepository(path: string): Promise<boolean> {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: path,
        stdio: 'pipe'
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get repository information
   */
  static async getRepositoryInfo(localPath: string) {
    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: localPath,
        encoding: 'utf8'
      }).trim();

      const currentCommit = execSync('git rev-parse HEAD', {
        cwd: localPath,
        encoding: 'utf8'
      }).trim();

      const remoteUrl = execSync('git remote get-url origin', {
        cwd: localPath,
        encoding: 'utf8'
      }).trim();

      return {
        branch: currentBranch,
        commit: currentCommit,
        remoteUrl,
        shortCommit: currentCommit.substring(0, 7)
      };
    } catch (error) {
      throw new Error(`Failed to get repository info: ${error}`);
    }
  }

  /**
   * Extract repository name from URL
   */
  private static extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/)?$/);
    return match ? `${match[1]}-${match[2]}` : 'unknown-repo';
  }

  /**
   * Validate repository URL
   */
  static isValidGitUrl(url: string): boolean {
    const gitUrlPatterns = [
      /^https?:\/\/(www\.)?(github|gitlab|bitbucket)\.com\/[^\/]+\/[^\/]+/,
      /^git@(github|gitlab|bitbucket)\.com:[^\/]+\/[^\/]+\.git$/,
      /^https?:\/\/[^\/]+\/[^\/]+\/[^\/]+\.git$/
    ];

    return gitUrlPatterns.some(pattern => pattern.test(url));
  }
}
