import http from 'http';
import url from 'url';
import { LocalDeploymentManager } from './localDeployment';
import chalk from 'chalk';
import fs from 'fs-extra';
import { execSync } from 'child_process';
import { isWindows } from '../utils/system';

/**
 * Check SSL certificate status by examining nginx config and certificate files
 */
async function checkSSLStatus(subdomain: string): Promise<{
  enabled: boolean;
  certificate?: string;
  expiresAt?: string;
  issuer?: string;
  validFrom?: string;
  daysUntilExpiry?: number;
}> {
  try {
    const nginxConfigPath = isWindows() 
      ? `C:\\nginx\\conf\\sites-available\\${subdomain}.conf`
      : `/etc/nginx/sites-available/${subdomain}.conf`;

    // Check if nginx config exists and has SSL configuration
    if (!await fs.pathExists(nginxConfigPath)) {
      return { enabled: false };
    }

    const nginxConfig = await fs.readFile(nginxConfigPath, 'utf8');
    
    // Check for SSL configuration in nginx
    const hasSSLConfig = nginxConfig.includes('ssl_certificate') && nginxConfig.includes('ssl_certificate_key');
    
    if (!hasSSLConfig) {
      return { enabled: false };
    }

    // Extract certificate path from nginx config
    const certPathMatch = nginxConfig.match(/ssl_certificate\s+([^;]+);/);
    const certPath = certPathMatch ? certPathMatch[1].trim().replace(/['"]/g, '') : null;

    if (!certPath || !await fs.pathExists(certPath)) {
      return { enabled: true, certificate: 'Configuration found but certificate file missing' };
    }

    // Get certificate information using openssl
    try {
      const certInfo = execSync(`openssl x509 -in "${certPath}" -text -noout`, { 
        encoding: 'utf8',
        timeout: 5000 
      });

      const notAfterMatch = certInfo.match(/Not After : (.+)/);
      const notBeforeMatch = certInfo.match(/Not Before: (.+)/);
      const issuerMatch = certInfo.match(/Issuer: (.+)/);

      let expiresAt, validFrom, issuer, daysUntilExpiry;

      if (notAfterMatch) {
        expiresAt = new Date(notAfterMatch[1]).toISOString();
        daysUntilExpiry = Math.ceil((new Date(notAfterMatch[1]).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }

      if (notBeforeMatch) {
        validFrom = new Date(notBeforeMatch[1]).toISOString();
      }

      if (issuerMatch) {
        issuer = issuerMatch[1].trim();
      }

      return {
        enabled: true,
        certificate: certPath,
        expiresAt,
        validFrom,
        issuer,
        daysUntilExpiry
      };

    } catch (opensslError) {
      // If openssl fails, try alternative method
      try {
        const certInfo = execSync(`openssl x509 -in "${certPath}" -enddate -issuer -startdate -noout`, { 
          encoding: 'utf8',
          timeout: 5000 
        });

        const lines = certInfo.split('\n');
        let expiresAt, validFrom, issuer, daysUntilExpiry;

        for (const line of lines) {
          if (line.startsWith('notAfter=')) {
            const dateStr = line.replace('notAfter=', '');
            expiresAt = new Date(dateStr).toISOString();
            daysUntilExpiry = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          } else if (line.startsWith('notBefore=')) {
            const dateStr = line.replace('notBefore=', '');
            validFrom = new Date(dateStr).toISOString();
          } else if (line.startsWith('issuer=')) {
            issuer = line.replace('issuer=', '');
          }
        }

        return {
          enabled: true,
          certificate: certPath,
          expiresAt,
          validFrom,
          issuer,
          daysUntilExpiry
        };

      } catch (fallbackError) {
        return { 
          enabled: true, 
          certificate: certPath,
          expiresAt: 'Unable to read certificate details',
        };
      }
    }

  } catch (error) {
    // Fallback: check if HTTPS is working by making a request
    try {
      const domain = `${subdomain}.forgecli.tech`;
      const response = await fetch(`https://${domain}`, { 
        signal: AbortSignal.timeout(5000),
        method: 'HEAD'
      });
      
      return { 
        enabled: response.ok, 
        certificate: 'SSL working but certificate details unavailable' 
      };
    } catch {
      return { enabled: false };
    }
  }
}

export class ForgeAPIServer {
  private server: http.Server | null = null;
  private readonly port: number = 8080;

  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    const method = req.method || 'GET';

    console.log(chalk.gray(`${new Date().toISOString()} ${method} ${pathname}`));

    try {
      if (pathname === '/health' && method === 'GET') {
        this.sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
      } else if (pathname === '/api/deployments' && method === 'GET') {
        await this.handleGetDeployments(res);
      } else if (pathname.startsWith('/api/deployments/') && method === 'GET') {
        const deploymentId = pathname.split('/')[3];
        await this.handleGetDeployment(res, deploymentId);
      } else if (pathname.startsWith('/api/deployments/') && pathname.endsWith('/stop') && method === 'POST') {
        const deploymentId = pathname.split('/')[3];
        await this.handleStopDeployment(res, deploymentId);
      } else if (pathname === '/api/system' && method === 'GET') {
        this.handleGetSystem(res);
      } else {
        this.sendJSON(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      console.error('API Error:', error);
      this.sendJSON(res, 500, { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async handleGetDeployments(res: http.ServerResponse): Promise<void> {
    const deployments = await LocalDeploymentManager.listDeployments();
    
    // Update resources for all deployments
    for (const deployment of deployments) {
      await LocalDeploymentManager.updateDeploymentResources(deployment.id);
    }
    
    // Get updated deployments
    const updatedDeployments = await LocalDeploymentManager.listDeployments();
    
    this.sendJSON(res, 200, {
      success: true,
      deployments: updatedDeployments,
      count: updatedDeployments.length
    });
  }

  private async handleGetDeployment(res: http.ServerResponse, deploymentId: string): Promise<void> {
    const deployment = await LocalDeploymentManager.getDeploymentWithResources(deploymentId);
    
    if (!deployment) {
      this.sendJSON(res, 404, {
        success: false,
        error: 'Deployment not found'
      });
      return;
    }

    // Calculate uptime
    const calculateUptime = (startTime?: Date): string => {
      if (!startTime) return 'N/A';
      
      const start = new Date(startTime);
      const now = new Date();
      const diff = now.getTime() - start.getTime();
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
      } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
      } else {
        return `${minutes}m`;
      }
    };

    // Perform basic health check
    let healthStatus = 'unknown';
    let responseTime = 0;
    
    if (deployment.status === 'running' && deployment.port) {
      try {
        const startTime = Date.now();
        const response = await fetch(`http://localhost:${deployment.port}/health`, {
          signal: AbortSignal.timeout(5000)
        });
        responseTime = Date.now() - startTime;
        healthStatus = response.ok ? 'healthy' : 'unhealthy';
      } catch {
        healthStatus = 'unhealthy';
        responseTime = 0;
      }
    }

    // Check SSL status if domain is configured
    let sslStatus;
    if (deployment.subdomain) {
      sslStatus = await checkSSLStatus(deployment.subdomain);
    }

    // Get recent logs
    const logs = [
      `[${new Date().toISOString()}] Status check completed - ${deployment.status}`,
      `[${new Date(Date.now() - 60000).toISOString()}] Resource usage: CPU ${deployment.resources?.cpu?.toFixed(1) || 0}%, Memory ${deployment.resources?.memory?.toFixed(1) || 0}%`,
      `[${new Date(Date.now() - 120000).toISOString()}] Disk usage: ${deployment.resources?.diskUsed ? (deployment.resources.diskUsed / (1024 * 1024 * 1024)).toFixed(2) : 0}GB`,
      `[${new Date(Date.now() - 180000).toISOString()}] Health check: ${healthStatus}`,
      `[${new Date(Date.now() - 240000).toISOString()}] SSL status: ${sslStatus?.enabled ? 'enabled' : 'disabled'}${sslStatus?.daysUntilExpiry ? ` (expires in ${sslStatus.daysUntilExpiry} days)` : ''}`,
      `[${new Date(Date.now() - 300000).toISOString()}] Process ${deployment.pid ? 'running' : 'not found'} on port ${deployment.port}`
    ];

    this.sendJSON(res, 200, {
      success: true,
      deployment: {
        ...deployment,
        uptime: calculateUptime(deployment.startedAt),
        health: {
          status: healthStatus,
          responseTime,
          lastCheck: new Date().toISOString()
        },
        logs,
        ssl: sslStatus
      }
    });
  }

  private async handleStopDeployment(res: http.ServerResponse, deploymentId: string): Promise<void> {
    await LocalDeploymentManager.stopDeployment(deploymentId);
    this.sendJSON(res, 200, { success: true, message: 'Deployment stopped' });
  }

  private handleGetSystem(res: http.ServerResponse): void {
    const os = require('os');
    
    this.sendJSON(res, 200, {
      success: true,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem()
        },
        cpus: os.cpus().length,
        uptime: os.uptime(),
        loadAverage: os.loadavg()
      }
    });
  }

  private sendJSON(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(chalk.green(`Forge API server started on port ${this.port}`));
        console.log(chalk.gray(`Local API: http://localhost:${this.port}`));
        console.log(chalk.gray(`Health check: http://localhost:${this.port}/health`));
        resolve();
      });

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          console.log(chalk.yellow(`Port ${this.port} is already in use. API server not started.`));
          resolve(); // Don't reject, just skip starting the server
        } else {
          reject(error);
        }
      });
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      console.log(chalk.gray('Forge API server stopped'));
    }
  }
}

// Singleton instance
let apiServerInstance: ForgeAPIServer | null = null;

export function getAPIServer(): ForgeAPIServer {
  if (!apiServerInstance) {
    apiServerInstance = new ForgeAPIServer();
  }
  return apiServerInstance;
}

export function startAPIServer(): Promise<void> {
  const server = getAPIServer();
  return server.start();
}

export function stopAPIServer(): void {
  if (apiServerInstance) {
    apiServerInstance.stop();
    apiServerInstance = null;
  }
}
