import fs from 'fs-extra';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import chalk from 'chalk';
import { getSystemIP, getPublicIP } from '../utils/system';
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
  status: 'running' | 'stopped' | 'failed' | 'paused';
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
    publicIP?: string;
  }): Promise<LocalDeployment> {
    try {
      console.log(chalk.cyan('Setting up local deployment...'));

      // Find available port
      const port = await this.findAvailablePort();
      console.log(chalk.gray(`Assigned port: ${port}`));

      // Create deployment record
      const localIP = getSystemIP();
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

      // Setup SSL certificate if public IP is available
      if (deploymentData.publicIP) {
        try {
          await this.setupSSLForDeployment(deploymentData.subdomain, deploymentData.publicIP);
        } catch (sslError) {
          console.log(chalk.yellow(`SSL setup skipped: ${sslError}`));
        }
      }

      // Save deployment record
      await this.saveDeployment(deployment);

      console.log(chalk.green('Local deployment configured successfully!'));
      console.log(chalk.blue('Local Access:'));
      console.log(`  ${chalk.cyan('Local URL:')} http://localhost:${port}`);
      console.log(`  ${chalk.cyan('Network URL:')} http://${localIP}:${port}`);
      console.log(`  ${chalk.cyan('Public URL:')} ${deployment.url}`);
      console.log();
      console.log(chalk.yellow('⚠️  For Public Access:'));
      console.log(chalk.gray(`  • Open port ${port} on your firewall`));
      console.log(chalk.gray(`  • Domain routing is handled automatically via API`));

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

      case Framework.DJANGO:
        // Django development server
        startScript = 'python manage.py runserver 0.0.0.0:' + port;
        interpreter = 'python';
        break;

      case Framework.FLASK:
        // Flask development server
        startScript = 'python app.py';
        interpreter = 'python';
        // Set Flask environment variables
        break;

      case Framework.FASTAPI:
        // FastAPI with uvicorn
        startScript = 'uvicorn main:app --host 0.0.0.0 --port ' + port;
        interpreter = 'none'; // uvicorn is the interpreter
        break;

      case Framework.STATIC:
        // Serve static files
        startScript = 'npx serve -s . -p ' + port;
        break;

      case Framework.NUXT:
        startScript = 'npm run start';
        break;

      default:
        // Try to detect based on files in project
        if (await this.hasFile(projectPath, 'manage.py')) {
          // Django project
          startScript = 'python manage.py runserver 0.0.0.0:' + port;
          interpreter = 'python';
        } else if (await this.hasFile(projectPath, 'app.py')) {
          // Flask project
          startScript = 'python app.py';
          interpreter = 'python';
        } else if (await this.hasFile(projectPath, 'main.py')) {
          // FastAPI or generic Python
          startScript = 'uvicorn main:app --host 0.0.0.0 --port ' + port;
          interpreter = 'none';
        } else {
          // Generic static file serving
          startScript = 'npx serve -s . -p ' + port;
        }
        break;
    }

    try {
      console.log(chalk.gray(`Starting application with PM2: ${startScript}`));
      
      // Create PM2 ecosystem file for this deployment
      const ecosystemConfig = {
        apps: [{
          name: `forge-${id}`,
          script: startScript.split(' ')[0],
          args: startScript.split(' ').slice(1).join(' '),
          cwd: cwd,
          interpreter: this.getInterpreter(startScript, interpreter),
          env: this.getEnvironmentVariables(framework, port),
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
      // Stop PM2 process - try multiple approaches
      const appName = `forge-${deploymentId}`;
      
      try {
        // First try to stop by name
        execSync(`pm2 stop ${appName}`, { stdio: 'pipe' });
        execSync(`pm2 delete ${appName}`, { stdio: 'pipe' });
        console.log(chalk.gray(`Stopped PM2 process: ${appName}`));
      } catch (pm2Error) {
        // If that fails, try to find and stop by ID or other name variations
        try {
          const pm2List = execSync('pm2 jlist', { encoding: 'utf8' });
          const processes = JSON.parse(pm2List);
          
          for (const proc of processes) {
            if (proc.name.includes(deploymentId) || proc.name === appName) {
              execSync(`pm2 stop ${proc.pm_id}`, { stdio: 'pipe' });
              execSync(`pm2 delete ${proc.pm_id}`, { stdio: 'pipe' });
              console.log(chalk.gray(`Stopped PM2 process: ${proc.name} (ID: ${proc.pm_id})`));
              break;
            }
          }
        } catch (listError) {
          console.log(chalk.yellow(`Warning: Could not stop PM2 process cleanly: ${pm2Error}`));
        }
      }
      
      // Remove ecosystem file
      const ecosystemPath = path.join(process.cwd(), `forge-${deploymentId}.config.js`);
      if (await fs.pathExists(ecosystemPath)) {
        await fs.remove(ecosystemPath);
        console.log(chalk.gray(`Removed ecosystem file: ${ecosystemPath}`));
      }
      
      // Remove nginx config
      const configPath = path.join(this.NGINX_CONFIG_DIR, `${deployment.subdomain}.conf`);
      if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
        console.log(chalk.gray(`Removed nginx config: ${configPath}`));
        
        // Reload nginx
        try {
          if (os.platform() === 'win32') {
            execSync('nginx -s reload', { stdio: 'pipe' });
          } else {
            execSync('sudo nginx -s reload', { stdio: 'pipe' });
          }
          console.log(chalk.gray('Nginx configuration reloaded'));
        } catch {
          console.log(chalk.yellow('Warning: Could not reload nginx automatically'));
        }
      }
      
      deployment.status = 'stopped';
      deployment.pid = undefined;
      
      await this.saveDeployment(deployment);
      console.log(chalk.green(`Deployment ${deploymentId} stopped successfully`));
      
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
  static async saveDeployment(deployment: LocalDeployment): Promise<void> {
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
    const localIP = getSystemIP();
    
    const nginxConfig = this.generateNginxConfig(subdomain, port, localIP);
    
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

    # Let's Encrypt challenge location
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect HTTP to HTTPS (will be enabled after SSL setup)
    # return 301 https://$server_name$request_uri;

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

# SSL configuration (will be automatically configured by certbot)
# server {
#     listen 443 ssl http2;
#     server_name ${subdomain}.agfe.tech;
#     
#     ssl_certificate /etc/letsencrypt/live/${subdomain}.agfe.tech/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/${subdomain}.agfe.tech/privkey.pem;
#     include /etc/letsencrypt/options-ssl-nginx.conf;
#     ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
#     
#     # Enhanced security headers for HTTPS
#     add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
#     add_header X-Frame-Options DENY;
#     add_header X-Content-Type-Options nosniff;
#     add_header X-XSS-Protection "1; mode=block";
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
#         
#         # Timeout settings
#         proxy_connect_timeout 30;
#         proxy_send_timeout 30;
#         proxy_read_timeout 30;
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

  /**
   * Setup SSL certificate for a deployment using Certbot
   */
  static async setupSSLForDeployment(subdomain: string, publicIP: string): Promise<void> {
    if (os.platform() === 'win32') {
      console.log(chalk.yellow('SSL certificate setup skipped on Windows'));
      console.log(chalk.gray('Consider using Cloudflare or another reverse proxy for SSL'));
      return;
    }

    try {
      console.log(chalk.cyan(`Setting up SSL certificate for ${subdomain}.agfe.tech...`));
      
      // Check if SSL setup script exists
      const fs = await import('fs-extra');
      const sslScript = '/usr/local/bin/forge-ssl-setup';
      
      if (await fs.pathExists(sslScript)) {
        // Run the SSL setup script
        execSync(`${sslScript} ${subdomain}.agfe.tech ${publicIP}`, { stdio: 'inherit' });
        console.log(chalk.green(`SSL certificate setup completed for ${subdomain}.agfe.tech`));
      } else {
        console.log(chalk.yellow('SSL setup script not found. Run "forge infra --ssl" first.'));
      }
    } catch (error) {
      console.log(chalk.yellow(`Warning: SSL certificate setup failed: ${error}`));
      console.log(chalk.gray('Your site will still work over HTTP'));
    }
  }

  /**
   * Get the appropriate interpreter for PM2 based on the start script
   */
  private static getInterpreter(startScript: string, interpreter: string): string | undefined {
    if (startScript.startsWith('npm') || startScript.startsWith('node')) {
      return undefined; // Node.js default
    }
    
    if (interpreter === 'python') {
      return 'python3';
    }
    
    if (interpreter === 'none' || startScript.startsWith('uvicorn') || startScript.startsWith('gunicorn')) {
      return undefined; // uvicorn/gunicorn are standalone executables
    }
    
    return interpreter === 'node' ? undefined : interpreter;
  }

  /**
   * Get environment variables for different frameworks
   */
  private static getEnvironmentVariables(framework: Framework, port: number): Record<string, string> {
    const baseEnv = {
      PORT: port.toString(),
    };

    switch (framework) {
      case Framework.NEXTJS:
      case Framework.REACT:
      case Framework.VUE:
      case Framework.ANGULAR:
      case Framework.EXPRESS:
      case Framework.FASTIFY:
      case Framework.NEST:
        return {
          ...baseEnv,
          NODE_ENV: 'production'
        };

      case Framework.DJANGO:
        return {
          ...baseEnv,
          DJANGO_SETTINGS_MODULE: 'settings',
          PYTHONPATH: '.',
          PYTHONUNBUFFERED: '1'
        };

      case Framework.FLASK:
        return {
          ...baseEnv,
          FLASK_APP: 'app.py',
          FLASK_ENV: 'production',
          PYTHONPATH: '.',
          PYTHONUNBUFFERED: '1'
        };

      case Framework.FASTAPI:
        return {
          ...baseEnv,
          PYTHONPATH: '.',
          PYTHONUNBUFFERED: '1'
        };

      default:
        return baseEnv;
    }
  }

  /**
   * Check if a file exists in the project directory
   */
  private static async hasFile(projectPath: string, filename: string): Promise<boolean> {
    const fs = await import('fs-extra');
    const filePath = path.join(projectPath, filename);
    return await fs.pathExists(filePath);
  }
}
