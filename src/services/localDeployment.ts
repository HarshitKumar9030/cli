import fs from 'fs-extra';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import chalk from 'chalk';
import { getSystemIP } from '../utils/system';
import { Framework } from '../types';

export interface LocalDeployment {
  id: string;
  projectName: string;
  subdomain: string;
  framework: Framework;
  projectPath: string;
  port: number;
  pid?: number;
  status: 'running' | 'stopped' | 'failed';
  url: string;
  startedAt?: Date;
  lastAccessed?: Date;
}

export class LocalDeploymentManager {
  private static readonly DEPLOYMENTS_FILE = path.join(process.cwd(), 'forge-deployments.json');
  private static readonly MIN_PORT = 3000;
  private static readonly MAX_PORT = 9999;
  private static readonly BASE_DOMAIN = 'agfe.tech';

  /**
   * Deploy a project locally
   */
  static async deployLocally(deploymentData: {
    id: string;
    projectName: string;
    subdomain: string;
    framework: Framework;
    projectPath: string;
    buildOutputDir?: string;
  }): Promise<LocalDeployment> {
    try {
      console.log(chalk.cyan('Setting up local deployment...'));

      // Find available port
      const port = await this.findAvailablePort();
      console.log(chalk.gray(`Assigned port: ${port}`));

      // Create deployment record
      const systemIP = getSystemIP();
      const deployment: LocalDeployment = {
        id: deploymentData.id,
        projectName: deploymentData.projectName,
        subdomain: deploymentData.subdomain,
        framework: deploymentData.framework,
        projectPath: deploymentData.projectPath,
        port,
        status: 'stopped',
        url: `http://${deploymentData.subdomain}.${this.BASE_DOMAIN}`
      };

      // Start the application
      await this.startApplication(deployment, deploymentData.buildOutputDir);

      // Save deployment record
      await this.saveDeployment(deployment);

      console.log(chalk.green('Local deployment configured successfully!'));
      console.log(chalk.blue('Local Access:'));
      console.log(`  ${chalk.cyan('Local URL:')} http://localhost:${port}`);
      console.log(`  ${chalk.cyan('Network URL:')} http://${systemIP}:${port}`);
      console.log(`  ${chalk.cyan('Public URL:')} ${deployment.url}`);
      console.log();
      console.log(chalk.yellow('⚠️  Port Configuration Required:'));
      console.log(chalk.gray(`  • Open port ${port} on your firewall for public access`));
      console.log(chalk.gray(`  • Configure DNS to point ${deploymentData.subdomain}.${this.BASE_DOMAIN} to ${systemIP}`));
      console.log(chalk.gray(`  • Or use a reverse proxy like nginx/cloudflare tunnel`));

      return deployment;

    } catch (error) {
      throw new Error(`Local deployment failed: ${error}`);
    }
  }

  /**
   * Start an application based on framework
   */
  private static async startApplication(deployment: LocalDeployment, buildOutputDir?: string): Promise<void> {
    const { framework, projectPath, port } = deployment;

    let startCommand: string;
    let cwd = projectPath;

    switch (framework) {
      case Framework.NEXTJS:
        startCommand = `npm start -- -p ${port}`;
        break;

      case Framework.REACT:
      case Framework.VUE:
      case Framework.ANGULAR:
        // Serve static build output
        if (buildOutputDir) {
          cwd = path.join(projectPath, buildOutputDir);
          startCommand = `npx serve -s . -p ${port}`;
        } else {
          startCommand = `npm start -- --port ${port}`;
        }
        break;

      case Framework.EXPRESS:
      case Framework.FASTIFY:
      case Framework.NEST:
        startCommand = `PORT=${port} npm start`;
        break;

      case Framework.STATIC:
        // Serve static files
        startCommand = `npx serve -s . -p ${port}`;
        break;

      case Framework.NUXT:
        startCommand = `PORT=${port} npm run start`;
        break;

      default:
        // Generic static file serving
        startCommand = `npx serve -s . -p ${port}`;
        break;
    }

    try {
      console.log(chalk.gray(`Starting application: ${startCommand}`));
      
      // Start the process in background
      const process = spawn('cmd', ['/c', startCommand], {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      deployment.pid = process.pid;
      deployment.status = 'running';
      deployment.startedAt = new Date();

      // Handle process events
      process.on('error', (error) => {
        console.error(chalk.red(`Process error: ${error}`));
        deployment.status = 'failed';
      });

      process.on('exit', (code) => {
        if (code !== 0) {
          console.error(chalk.red(`Process exited with code ${code}`));
          deployment.status = 'failed';
        } else {
          deployment.status = 'stopped';
        }
      });

      // Give the process time to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log(chalk.green(`Application started on port ${port}`));

    } catch (error) {
      deployment.status = 'failed';
      throw new Error(`Failed to start application: ${error}`);
    }
  }

  /**
   * Stop a local deployment
   */
  static async stopDeployment(deploymentId: string): Promise<void> {
    const deployment = await this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error('Deployment not found');
    }

    if (deployment.pid) {
      try {
        // Kill the process
        process.kill(deployment.pid, 'SIGTERM');
        deployment.status = 'stopped';
        deployment.pid = undefined;
        
        await this.saveDeployment(deployment);
        console.log(chalk.green(`Deployment ${deploymentId} stopped`));
      } catch (error) {
        throw new Error(`Failed to stop deployment: ${error}`);
      }
    }
  }

  /**
   * List all local deployments
   */
  static async listDeployments(): Promise<LocalDeployment[]> {
    try {
      if (!await fs.pathExists(this.DEPLOYMENTS_FILE)) {
        return [];
      }

      const data = await fs.readJSON(this.DEPLOYMENTS_FILE);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific deployment
   */
  static async getDeployment(deploymentId: string): Promise<LocalDeployment | null> {
    const deployments = await this.listDeployments();
    return deployments.find(d => d.id === deploymentId) || null;
  }

  /**
   * Save deployment to file
   */
  private static async saveDeployment(deployment: LocalDeployment): Promise<void> {
    const deployments = await this.listDeployments();
    const index = deployments.findIndex(d => d.id === deployment.id);
    
    if (index >= 0) {
      deployments[index] = deployment;
    } else {
      deployments.push(deployment);
    }

    await fs.writeJSON(this.DEPLOYMENTS_FILE, deployments, { spaces: 2 });
  }

  /**
   * Find an available port
   */
  private static async findAvailablePort(): Promise<number> {
    const net = await import('net');
    
    for (let port = this.MIN_PORT; port <= this.MAX_PORT; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    
    throw new Error('No available ports found');
  }

  /**
   * Check if port is available
   */
  private static async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => resolve(true));
        server.close();
      });
      
      server.on('error', () => resolve(false));
    });
  }

  /**
   * Install serve package if not available
   */
  static async ensureServeInstalled(): Promise<void> {
    try {
      execSync('npx serve --version', { stdio: 'pipe' });
    } catch {
      console.log(chalk.cyan('Installing serve package...'));
      execSync('npm install -g serve', { stdio: 'inherit' });
    }
  }

  /**
   * Clean up stopped deployments
   */
  static async cleanup(): Promise<void> {
    const deployments = await this.listDeployments();
    const activeDeployments = deployments.filter(deployment => {
      if (deployment.pid) {
        try {
          // Check if process is still running
          process.kill(deployment.pid, 0);
          return true;
        } catch {
          // Process not running
          deployment.status = 'stopped';
          deployment.pid = undefined;
          return true;
        }
      }
      return true;
    });

    await fs.writeJSON(this.DEPLOYMENTS_FILE, activeDeployments, { spaces: 2 });
  }

  /**
   * Get deployment status with health check
   */
  static async getDeploymentStatus(deploymentId: string): Promise<LocalDeployment | null> {
    const deployment = await this.getDeployment(deploymentId);
    if (!deployment) return null;

    // Health check
    if (deployment.pid && deployment.status === 'running') {
      try {
        const response = await fetch(`http://localhost:${deployment.port}`, {
          signal: AbortSignal.timeout(5000)
        });
        deployment.lastAccessed = new Date();
        if (response.ok) {
          deployment.status = 'running';
        } else {
          deployment.status = 'failed';
        }
      } catch {
        deployment.status = 'failed';
      }
      
      await this.saveDeployment(deployment);
    }

    return deployment;
  }
}
