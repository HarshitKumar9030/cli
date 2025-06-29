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
    : '/etc/nginx/forge-sites';
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
          script: startScript.includes('npx') ? 'npx' : startScript.split(' ')[0],
          args: startScript.includes('npx') ? startScript.split(' ').slice(1).join(' ') : startScript.split(' ').slice(1).join(' '),
          cwd: cwd,
          interpreter: this.getInterpreter(startScript, interpreter),
          env: this.getEnvironmentVariables(framework, port),
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: '1G',
          min_uptime: '10s',
          max_restarts: 5,
          restart_delay: 1000,
          error_file: path.join(process.cwd(), `logs/${id}-error.log`),
          out_file: path.join(process.cwd(), `logs/${id}-out.log`),
          log_file: path.join(process.cwd(), `logs/${id}-combined.log`),
          time: true,
          merge_logs: true,
          kill_timeout: 5000
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
    
    try {
      // Ensure nginx config directory exists
      await fs.ensureDir(this.NGINX_CONFIG_DIR);
      
      // Generate nginx configuration
      const nginxConfig = this.generateNginxConfig(subdomain, port);
      
      const configPath = path.join(this.NGINX_CONFIG_DIR, `${subdomain}.conf`);
      await fs.writeFile(configPath, nginxConfig);
      
      console.log(chalk.gray(`Nginx config created: ${configPath}`));
      
      // Test configuration before applying
      if (await this.testNginxConfig()) {
        // Reload nginx if running
        await this.reloadNginx();
        console.log(chalk.green('Nginx configuration applied successfully'));
      } else {
        throw new Error('Nginx configuration test failed');
      }
      
    } catch (error) {
      console.log(chalk.yellow(`Warning: Could not setup nginx config: ${error}`));
      throw error;
    }
  }

  /**
   * Generate nginx configuration for a deployment with wildcard SSL support and better security
   */
  private static generateNginxConfig(subdomain: string, port: number): string {
    const domain = `${subdomain}.agfe.tech`;
    const baseDomain = 'agfe.tech';
    
    return `# Forge deployment configuration for ${subdomain}
# Generated on ${new Date().toISOString()}
# Wildcard SSL certificate: *.agfe.tech

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=${subdomain}_ratelimit:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=${subdomain}_login:10m rate=5r/m;

# Upstream definition with health checks
upstream ${subdomain}_backend {
    server 127.0.0.1:${port} max_fails=3 fail_timeout=30s;
    keepalive 32;
}

# HTTP server - handles ACME challenges and redirects to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    
    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Let's Encrypt ACME challenge location
    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }
    
    # Health check endpoint (accessible via HTTP)
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
    
    # Redirect all other HTTP traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server with wildcard certificate
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain};
    
    # Wildcard SSL certificate configuration
    ssl_certificate /etc/letsencrypt/live/${baseDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${baseDomain}/privkey.pem;
    
    # Include Let's Encrypt recommended SSL settings
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    
    # Enhanced security headers for HTTPS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss: https:;" always;
    add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
    
    # Rate limiting with different zones for different endpoints
    location /auth {
        limit_req zone=${subdomain}_login burst=10 nodelay;
        # Continue to proxy...
        proxy_pass http://${subdomain}_backend;
        include /etc/nginx/proxy_params;
    }
    
    location / {
        limit_req zone=${subdomain}_ratelimit burst=50 nodelay;
        
        # Main application proxy
        proxy_pass http://${subdomain}_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 8k;
        proxy_buffers 16 8k;
        proxy_busy_buffers_size 16k;
        
        # Handle WebSocket connections
        proxy_set_header Sec-WebSocket-Extensions $http_sec_websocket_extensions;
        proxy_set_header Sec-WebSocket-Key $http_sec_websocket_key;
        proxy_set_header Sec-WebSocket-Version $http_sec_websocket_version;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
    
    # Static file optimization with proper caching
    location ~* \\.(jpg|jpeg|png|gif|ico|svg|webp|avif)$ {
        proxy_pass http://${subdomain}_backend;
        include /etc/nginx/proxy_params;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Vary "Accept-Encoding";
    }
    
    location ~* \\.(css|js|woff|woff2|ttf|eot)$ {
        proxy_pass http://${subdomain}_backend;
        include /etc/nginx/proxy_params;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header Vary "Accept-Encoding";
    }
    
    # API endpoints with stricter rate limiting
    location /api/ {
        limit_req zone=${subdomain}_ratelimit burst=30 nodelay;
        
        proxy_pass http://${subdomain}_backend;
        include /etc/nginx/proxy_params;
        
        # API-specific headers
        add_header X-API-Version "1.0" always;
    }
}

# Logging configuration with rotation
access_log /var/log/nginx/${subdomain}_access.log combined buffer=16k flush=5m;
error_log /var/log/nginx/${subdomain}_error.log warn;
`;
  }

  /**
   * Test nginx configuration
   */
  private static async testNginxConfig(): Promise<boolean> {
    const { execSync } = await import('child_process');
    
    try {
      execSync('nginx -t', { stdio: 'pipe' });
      return true;
    } catch (error) {
      console.log(chalk.red('Nginx configuration test failed:'));
      try {
        execSync('nginx -t', { stdio: 'inherit' });
      } catch {
        // Error already shown above
      }
      return false;
    }
  }

  /**
   * Reload nginx configuration
   */
  private static async reloadNginx(): Promise<void> {
    const { execSync } = await import('child_process');
    
    try {
      if (os.platform() === 'win32') {
        execSync('nginx -s reload', { stdio: 'pipe' });
      } else {
        // Try systemctl first, then fallback to nginx -s reload
        try {
          execSync('systemctl reload nginx', { stdio: 'pipe' });
        } catch {
          execSync('nginx -s reload', { stdio: 'pipe' });
        }
      }
    } catch (error) {
      throw new Error(`Failed to reload nginx: ${error}`);
    }
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
          : 'include /etc/nginx/forge-sites/*.conf;';
        
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
   * Setup SSL certificate for a deployment using wildcard certificate
   */
  static async setupSSLForDeployment(subdomain: string, publicIP: string): Promise<void> {
    if (os.platform() === 'win32') {
      console.log(chalk.yellow('SSL certificate setup skipped on Windows'));
      console.log(chalk.gray('Consider using Cloudflare or another reverse proxy for SSL'));
      return;
    }

    const domain = `${subdomain}.agfe.tech`;
    const baseDomain = 'agfe.tech';
    
    try {
      console.log(chalk.cyan(`Setting up SSL for ${domain} using wildcard certificate...`));
      
      // Check if wildcard certificate exists
      const certPath = `/etc/letsencrypt/live/${baseDomain}`;
      const fs = await import('fs-extra');
      
      if (!await fs.pathExists(certPath)) {
        console.log(chalk.yellow('Wildcard certificate not found. Setting up SSL infrastructure first...'));
        
        // Try to setup wildcard certificate
        await this.setupWildcardCertificateIfNeeded();
        
        // Check again
        if (!await fs.pathExists(certPath)) {
          throw new Error('Wildcard certificate setup failed. Run "forge infra --ssl" first.');
        }
      }
      
      console.log(chalk.green('Wildcard SSL certificate found for *.agfe.tech'));
      
      // Update Cloudflare DNS record for the subdomain
      await this.updateCloudflareRecord(subdomain, publicIP);
      
      // Test nginx configuration
      if (!await this.testNginxConfig()) {
        throw new Error('Nginx configuration test failed');
      }
      
      // Reload nginx to apply SSL configuration
      await this.reloadNginx();
      
      console.log(chalk.green(`SSL setup completed for ${domain}`));
      
      // Verify SSL is working
      await this.verifySSLConfiguration(domain);
      
    } catch (error) {
      console.log(chalk.yellow(`Warning: SSL setup failed: ${error}`));
      console.log(chalk.gray('Your site will still work over HTTP'));
    }
  }

  /**
   * Setup wildcard certificate if it doesn't exist
   */
  private static async setupWildcardCertificateIfNeeded(): Promise<void> {
    console.log(chalk.yellow('Wildcard certificate setup is now handled during infrastructure setup.'));
    console.log(chalk.gray('Run "forge infra --ssl" to set up SSL certificates.'));
    throw new Error('SSL infrastructure not configured. Run "forge infra --ssl" first.');
  }

  /**
   * Update Cloudflare DNS record for subdomain via API
   */
  private static async updateCloudflareRecord(subdomain: string, publicIP: string): Promise<void> {
    try {
      console.log(chalk.gray(`Updating DNS record for ${subdomain}.agfe.tech -> ${publicIP} via API...`));
      
      // Get API service
      const { ConfigService } = await import('./config');
      const { ForgeApiService } = await import('./api');
      
      const configService = new ConfigService();
      const globalConfig = await configService.loadGlobalConfig();
      
      if (!globalConfig?.apiKey) {
        throw new Error('API key not found. Run "forge login" first.');
      }
      
      const apiService = new ForgeApiService();
      apiService.setApiKey(globalConfig.apiKey);
      
      // Create or update subdomain via API
      const response = await apiService.updateSubdomain(subdomain, publicIP);
      
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update DNS record');
      }
      
      console.log(chalk.green(`DNS record updated for ${subdomain}.agfe.tech`));
      
    } catch (error) {
      console.log(chalk.yellow(`Warning: Could not update DNS record: ${error}`));
      console.log(chalk.gray('DNS updates are handled via the Forge API for security'));
    }
  }

  /**
   * Get the appropriate interpreter for PM2 based on the start script
   */
  private static getInterpreter(startScript: string, interpreter: string): string | undefined {
    // Handle npx commands
    if (startScript.startsWith('npx')) {
      return undefined; // Node.js default for npx
    }
    
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

  /**
   * Verify SSL configuration is working
   */
  private static async verifySSLConfiguration(domain: string): Promise<void> {
    console.log(chalk.gray('Verifying SSL configuration...'));
    
    try {
      // Give nginx time to reload
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Test HTTPS endpoint
      const response = await fetch(`https://${domain}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.ok) {
        console.log(chalk.green('✅ SSL configuration verified - HTTPS is working'));
      } else {
        console.log(chalk.yellow('⚠️  HTTPS endpoint returned non-200 status'));
      }
      
    } catch (error) {
      console.log(chalk.yellow(`⚠️  SSL verification failed: ${error}`));
      console.log(chalk.gray('SSL certificate may be valid but application not responding'));
    }
  }
}
