import fs from 'fs-extra';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import chalk from 'chalk';
import { getSystemIP } from '../utils/system';
import { Framework } from '../types';
import os from 'os';

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
  private static readonly NGINX_CONFIG_DIR = os.platform() === 'win32' 
    ? 'C:\\nginx\\conf\\forge-sites'
    : '/etc/nginx/sites-available';
  private static readonly PM2_ECOSYSTEM_FILE = path.join(process.cwd(), 'forge-ecosystem.config.js');

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

      // Setup nginx configuration
      await this.setupNginxConfig(deployment);

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
   * Start an application using PM2 for better process management
   */
  private static async startApplication(deployment: LocalDeployment, buildOutputDir?: string): Promise<void> {
    const { framework, projectPath, port, id } = deployment;

    // Ensure PM2 is installed
    await this.ensurePM2Installed();

    let startScript: string;
    let cwd = projectPath;
    let interpreter = 'node';

    switch (framework) {
      case Framework.NEXTJS:
        startScript = 'npm start';
        break;

      case Framework.REACT:
      case Framework.VUE:
      case Framework.ANGULAR:
        // Serve static build output
        if (buildOutputDir) {
          cwd = path.join(projectPath, buildOutputDir);
          startScript = 'npx serve -s . -p ' + port;
        } else {
          startScript = 'npm start';
        }
        break;

      case Framework.EXPRESS:
      case Framework.FASTIFY:
      case Framework.NEST:
        startScript = 'npm start';
        break;

      case Framework.STATIC:
        // Serve static files
        startScript = 'npx serve -s . -p ' + port;
        break;

      case Framework.NUXT:
        startScript = 'npm run start';
        break;

      default:
        // Generic static file serving
        startScript = 'npx serve -s . -p ' + port;
        break;
    }

    try {
      console.log(chalk.gray(`Starting application with PM2: ${startScript}`));
      
      // Create PM2 ecosystem file for this deployment
      const ecosystemConfig = {
        apps: [{
          name: `forge-${id}`,
          script: startScript.split(' ')[0] === 'npm' ? 'npm' : startScript.split(' ')[0],
          args: startScript.split(' ').slice(1).join(' '),
          cwd: cwd,
          interpreter: startScript.startsWith('npm') ? undefined : interpreter,
          env: {
            PORT: port.toString(),
            NODE_ENV: 'production'
          },
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: '1G',
          error_file: path.join(process.cwd(), `logs/${id}-error.log`),
          out_file: path.join(process.cwd(), `logs/${id}-out.log`),
          log_file: path.join(process.cwd(), `logs/${id}-combined.log`),
          time: true
        }]
      };

      // Ensure logs directory exists
      await fs.ensureDir(path.join(process.cwd(), 'logs'));

      // Write ecosystem file
      const ecosystemPath = path.join(process.cwd(), `forge-${id}.config.js`);
      await fs.writeFile(ecosystemPath, `module.exports = ${JSON.stringify(ecosystemConfig, null, 2)}`);

      // Start with PM2
      execSync(`pm2 start ${ecosystemPath}`, { stdio: 'inherit' });
      
      // Save PM2 configuration
      execSync('pm2 save', { stdio: 'pipe' });

      deployment.status = 'running';
      deployment.startedAt = new Date();

      console.log(chalk.green(`Application started with PM2 on port ${port}`));

    } catch (error) {
      deployment.status = 'failed';
      throw new Error(`Failed to start application with PM2: ${error}`);
    }
  }

  /**
   * Stop a local deployment using PM2
   */
  static async stopDeployment(deploymentId: string): Promise<void> {
    const deployment = await this.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error('Deployment not found');
    }

    try {
      // Stop PM2 process
      const appName = `forge-${deploymentId}`;
      execSync(`pm2 stop ${appName}`, { stdio: 'pipe' });
      execSync(`pm2 delete ${appName}`, { stdio: 'pipe' });
      
      // Remove ecosystem file
      const ecosystemPath = path.join(process.cwd(), `forge-${deploymentId}.config.js`);
      if (await fs.pathExists(ecosystemPath)) {
        await fs.remove(ecosystemPath);
      }
      
      // Remove nginx config
      const configPath = path.join(this.NGINX_CONFIG_DIR, `${deployment.subdomain}.conf`);
      if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
        
        // Reload nginx
        try {
          if (os.platform() === 'win32') {
            execSync('nginx -s reload', { stdio: 'pipe' });
          } else {
            execSync('sudo nginx -s reload', { stdio: 'pipe' });
          }
        } catch {
          console.log(chalk.yellow('Warning: Could not reload nginx'));
        }
      }
      
      deployment.status = 'stopped';
      deployment.pid = undefined;
      
      await this.saveDeployment(deployment);
      console.log(chalk.green(`Deployment ${deploymentId} stopped`));
      
    } catch (error) {
      throw new Error(`Failed to stop deployment: ${error}`);
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

  /**
   * Ensure PM2 is installed
   */
  private static async ensurePM2Installed(): Promise<void> {
    try {
      execSync('pm2 --version', { stdio: 'pipe' });
    } catch {
      console.log(chalk.cyan('Installing PM2 for process management...'));
      execSync('npm install -g pm2', { stdio: 'inherit' });
      
      // Setup PM2 startup on Windows/Linux
      try {
        if (os.platform() === 'win32') {
          execSync('pm2-windows-service install', { stdio: 'inherit' });
        } else {
          execSync('pm2 startup', { stdio: 'inherit' });
        }
      } catch (error) {
        console.log(chalk.yellow('Warning: Could not setup PM2 auto-startup'));
      }
    }
  }

  /**
   * Setup nginx configuration for the deployment
   */
  private static async setupNginxConfig(deployment: LocalDeployment): Promise<void> {
    const { subdomain, port } = deployment;
    const systemIP = getSystemIP();
    
    const nginxConfig = this.generateNginxConfig(subdomain, port, systemIP);
    
    try {
      // Ensure nginx config directory exists
      await fs.ensureDir(this.NGINX_CONFIG_DIR);
      
      const configPath = path.join(this.NGINX_CONFIG_DIR, `${subdomain}.conf`);
      await fs.writeFile(configPath, nginxConfig);
      
      console.log(chalk.gray(`Nginx config created: ${configPath}`));
      
      // Reload nginx if running
      try {
        if (os.platform() === 'win32') {
          execSync('nginx -s reload', { stdio: 'pipe' });
        } else {
          execSync('sudo nginx -s reload', { stdio: 'pipe' });
        }
        console.log(chalk.green('Nginx configuration reloaded'));
      } catch {
        console.log(chalk.yellow('Warning: Could not reload nginx automatically'));
        console.log(chalk.gray('Run "nginx -s reload" or "sudo nginx -s reload" manually'));
      }
      
    } catch (error) {
      console.log(chalk.yellow(`Warning: Could not setup nginx config: ${error}`));
    }
  }

  /**
   * Generate nginx configuration for a deployment
   */
  private static generateNginxConfig(subdomain: string, port: number, systemIP: string): string {
    return `# Forge deployment: ${subdomain}
server {
    listen 80;
    server_name ${subdomain}.agfe.tech;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Proxy to local application
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 30;
        proxy_send_timeout 30;
        proxy_read_timeout 30;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
}

# Optional HTTPS redirect (uncomment when SSL is setup)
# server {
#     listen 443 ssl http2;
#     server_name ${subdomain}.agfe.tech;
#     
#     ssl_certificate /path/to/certificate.crt;
#     ssl_certificate_key /path/to/private.key;
#     
#     location / {
#         proxy_pass http://127.0.0.1:${port};
#         proxy_http_version 1.1;
#         proxy_set_header Upgrade $http_upgrade;
#         proxy_set_header Connection 'upgrade';
#         proxy_set_header Host $host;
#         proxy_set_header X-Real-IP $remote_addr;
#         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#         proxy_set_header X-Forwarded-Proto $scheme;
#         proxy_cache_bypass $http_upgrade;
#     }
# }
`;
  }

  /**
   * Install and configure nginx
   */
  static async setupNginx(): Promise<void> {
    console.log(chalk.cyan('Setting up nginx...'));
    
    try {
      if (os.platform() === 'win32') {
        // Windows nginx setup
        console.log(chalk.gray('For Windows, please manually install nginx:'));
        console.log(chalk.gray('1. Download nginx from http://nginx.org/en/download.html'));
        console.log(chalk.gray('2. Extract to C:\\nginx'));
        console.log(chalk.gray('3. Run "C:\\nginx\\nginx.exe" to start'));
      } else {
        // Linux nginx setup
        try {
          execSync('which nginx', { stdio: 'pipe' });
          console.log(chalk.green('Nginx is already installed'));
        } catch {
          console.log(chalk.cyan('Installing nginx...'));
          
          // Detect package manager and install
          try {
            execSync('apt-get update && apt-get install -y nginx', { stdio: 'inherit' });
          } catch {
            try {
              execSync('yum install -y nginx', { stdio: 'inherit' });
            } catch {
              try {
                execSync('dnf install -y nginx', { stdio: 'inherit' });
              } catch {
                throw new Error('Could not install nginx automatically');
              }
            }
          }
        }
        
        // Enable and start nginx
        try {
          execSync('systemctl enable nginx', { stdio: 'pipe' });
          execSync('systemctl start nginx', { stdio: 'pipe' });
          console.log(chalk.green('Nginx enabled and started'));
        } catch {
          console.log(chalk.yellow('Warning: Could not enable/start nginx automatically'));
        }
      }
      
      // Create nginx configuration directory
      await fs.ensureDir(this.NGINX_CONFIG_DIR);
      
      // Create main nginx config if needed
      await this.ensureMainNginxConfig();
      
    } catch (error) {
      console.log(chalk.red(`Failed to setup nginx: ${error}`));
      throw error;
    }
  }

  /**
   * Ensure main nginx configuration includes forge sites
   */
  private static async ensureMainNginxConfig(): Promise<void> {
    const mainConfigPath = os.platform() === 'win32' 
      ? 'C:\\nginx\\conf\\nginx.conf'
      : '/etc/nginx/nginx.conf';
    
    try {
      if (await fs.pathExists(mainConfigPath)) {
        const config = await fs.readFile(mainConfigPath, 'utf8');
        const includePattern = os.platform() === 'win32'
          ? 'include forge-sites/*.conf;'
          : 'include /etc/nginx/sites-available/*.conf;';
        
        if (!config.includes(includePattern)) {
          console.log(chalk.gray('Adding forge sites include to nginx.conf'));
          // Add include directive in http block
          const updatedConfig = config.replace(
            /http\s*{/,
            `http {\n    ${includePattern}`
          );
          await fs.writeFile(mainConfigPath, updatedConfig);
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`Warning: Could not update main nginx config: ${error}`));
    }
  }
}
