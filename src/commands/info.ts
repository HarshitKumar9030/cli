import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { ConfigService } from '../services/config';
import { ForgeApiService } from '../services/api';
import { LocalDeploymentManager } from '../services/localDeployment';
import { isWindows } from '../utils/system';

interface InfoOptions {
  deploymentId?: string;
  local?: boolean;
  json?: boolean;
}

export async function infoCommand(options: InfoOptions): Promise<void> {
  try {
    if (options.local) {
      await showLocalDeploymentInfo(options);
    } else {
      await showRemoteDeploymentInfo(options);
    }
  } catch (error) {
    console.error(chalk.red('Failed to fetch deployment info:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function showLocalDeploymentInfo(options: InfoOptions): Promise<void> {
  const deployments = await LocalDeploymentManager.listDeployments();
  
  if (options.deploymentId) {
    const deployment = deployments.find(d => d.id === options.deploymentId);
    if (!deployment) {
      console.error(chalk.red(`Local deployment ${options.deploymentId} not found`));
      process.exit(1);
    }
    
    await displayDeploymentInfo(deployment, options.json);
  } else {
    if (deployments.length === 0) {
      console.log(chalk.yellow('No local deployments found'));
      return;
    }
    
    console.log(chalk.blue.bold('Local Deployments:'));
    deployments.forEach(deployment => {
      console.log(chalk.cyan(`  ${deployment.id} - ${deployment.projectName} (${deployment.status})`));
    });
    console.log();
    console.log(chalk.gray('Use: forge info --local --deployment-id <deployment-id> for detailed information'));
  }
}

async function showRemoteDeploymentInfo(options: InfoOptions): Promise<void> {
  const configService = new ConfigService();
  const config = await configService.getConfig();

  if (!config.apiKey) {
    console.error(chalk.red('Not logged in. Please run: forge login'));
    process.exit(1);
  }

  const apiService = new ForgeApiService(config.apiUrl);
  apiService.setApiKey(config.apiKey);

  let deploymentId = options.deploymentId;
  
  if (!deploymentId) {
    deploymentId = config.deploymentId;
    if (!deploymentId) {
      console.error(chalk.red('No deployment ID provided and no current project deployment found'));
      console.log(chalk.gray('Use: forge info --deployment-id <deployment-id>'));
      process.exit(1);
    }
  }

  const response = await apiService.getDeployments({ id: deploymentId });
  
  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to fetch deployment');
  }

  const deployments = response.data?.deployments || [];
  if (deployments.length === 0) {
    console.error(chalk.red(`Deployment ${deploymentId} not found`));
    process.exit(1);
  }

  await displayDeploymentInfo(deployments[0], options.json);
}

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
      ? `C:\\\\nginx\\\\conf\\\\sites-available\\\\${subdomain}.conf`
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
    const certPathMatch = nginxConfig.match(/ssl_certificate\\s+([^;]+);/);
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

        const lines = certInfo.split('\\n');
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

/**
 * Get enhanced system metrics
 */
async function getSystemMetrics(): Promise<{
  cpu: number;
  memory: { used: number; total: number; percentage: number };
  disk: { used: number; total: number; percentage: number };
  uptime: number;
  loadAverage?: number[];
}> {
  try {
    if (isWindows()) {
      return await getWindowsMetrics();
    } else {
      return await getUnixMetrics();
    }
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not fetch system metrics'));
    return {
      cpu: 0,
      memory: { used: 0, total: 0, percentage: 0 },
      disk: { used: 0, total: 0, percentage: 0 },
      uptime: 0
    };
  }
}

async function getWindowsMetrics(): Promise<any> {
  try {
    // Get CPU usage
    const cpuInfo = execSync('wmic cpu get loadpercentage /value', { encoding: 'utf8', timeout: 5000 });
    const cpuMatch = cpuInfo.match(/LoadPercentage=(\\d+)/);
    const cpu = cpuMatch ? parseInt(cpuMatch[1]) : 0;

    // Get memory info
    const memInfo = execSync('wmic computersystem get TotalPhysicalMemory /value', { encoding: 'utf8', timeout: 5000 });
    const memAvail = execSync('wmic OS get AvailablePhysicalMemory /value', { encoding: 'utf8', timeout: 5000 });
    
    const totalMatch = memInfo.match(/TotalPhysicalMemory=(\\d+)/);
    const availMatch = memAvail.match(/AvailablePhysicalMemory=(\\d+)/);
    
    const totalMemory = totalMatch ? parseInt(totalMatch[1]) : 0;
    const availableMemory = availMatch ? parseInt(availMatch[1]) * 1024 : 0; // Convert KB to bytes
    const usedMemory = totalMemory - availableMemory;
    const memoryPercentage = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;

    // Get disk info (C: drive)
    const diskInfo = execSync('wmic logicaldisk where caption="C:" get size,freespace /value', { encoding: 'utf8', timeout: 5000 });
    const diskSizeMatch = diskInfo.match(/Size=(\\d+)/);
    const diskFreeMatch = diskInfo.match(/FreeSpace=(\\d+)/);
    
    const diskTotal = diskSizeMatch ? parseInt(diskSizeMatch[1]) : 0;
    const diskFree = diskFreeMatch ? parseInt(diskFreeMatch[1]) : 0;
    const diskUsed = diskTotal - diskFree;
    const diskPercentage = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

    // Get uptime
    const uptimeInfo = execSync('wmic os get lastbootuptime /value', { encoding: 'utf8', timeout: 5000 });
    const bootTimeMatch = uptimeInfo.match(/LastBootUpTime=(\\d{14})/);
    let uptime = 0;
    
    if (bootTimeMatch) {
      const bootTimeStr = bootTimeMatch[1];
      const bootYear = parseInt(bootTimeStr.substr(0, 4));
      const bootMonth = parseInt(bootTimeStr.substr(4, 2)) - 1;
      const bootDay = parseInt(bootTimeStr.substr(6, 2));
      const bootHour = parseInt(bootTimeStr.substr(8, 2));
      const bootMin = parseInt(bootTimeStr.substr(10, 2));
      const bootSec = parseInt(bootTimeStr.substr(12, 2));
      
      const bootTime = new Date(bootYear, bootMonth, bootDay, bootHour, bootMin, bootSec);
      uptime = Math.floor((Date.now() - bootTime.getTime()) / 1000);
    }

    return {
      cpu,
      memory: {
        used: usedMemory,
        total: totalMemory,
        percentage: memoryPercentage
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percentage: diskPercentage
      },
      uptime
    };

  } catch (error) {
    throw new Error(`Windows metrics failed: ${error}`);
  }
}

async function getUnixMetrics(): Promise<any> {
  try {
    // Get CPU usage from top
    const cpuInfo = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | sed 's/%us,//'", { encoding: 'utf8', timeout: 5000 });
    const cpu = parseFloat(cpuInfo.trim()) || 0;

    // Get memory info
    const memInfo = execSync('free -b', { encoding: 'utf8', timeout: 5000 });
    const memLines = memInfo.split('\\n');
    const memLine = memLines.find(line => line.startsWith('Mem:'));
    
    let totalMemory = 0, usedMemory = 0, memoryPercentage = 0;
    
    if (memLine) {
      const memParts = memLine.split(/\\s+/);
      totalMemory = parseInt(memParts[1]) || 0;
      usedMemory = parseInt(memParts[2]) || 0;
      memoryPercentage = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;
    }

    // Get disk info
    const diskInfo = execSync('df -B1 /', { encoding: 'utf8', timeout: 5000 });
    const diskLines = diskInfo.split('\\n');
    const diskLine = diskLines[1]; // Second line has the data
    
    let diskTotal = 0, diskUsed = 0, diskPercentage = 0;
    
    if (diskLine) {
      const diskParts = diskLine.split(/\\s+/);
      diskTotal = parseInt(diskParts[1]) || 0;
      diskUsed = parseInt(diskParts[2]) || 0;
      diskPercentage = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
    }

    // Get uptime
    const uptimeInfo = execSync('cat /proc/uptime', { encoding: 'utf8', timeout: 5000 });
    const uptime = parseFloat(uptimeInfo.split(' ')[0]) || 0;

    // Get load average
    const loadInfo = execSync('cat /proc/loadavg', { encoding: 'utf8', timeout: 5000 });
    const loadParts = loadInfo.split(' ');
    const loadAverage = [
      parseFloat(loadParts[0]) || 0,
      parseFloat(loadParts[1]) || 0,
      parseFloat(loadParts[2]) || 0
    ];

    return {
      cpu,
      memory: {
        used: usedMemory,
        total: totalMemory,
        percentage: memoryPercentage
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percentage: diskPercentage
      },
      uptime: Math.floor(uptime),
      loadAverage
    };

  } catch (error) {
    throw new Error(`Unix metrics failed: ${error}`);
  }
}

async function displayDeploymentInfo(deployment: any, jsonOutput: boolean = false): Promise<void> {
  // Update resources for local deployments
  if (deployment.port && deployment.id) {
    await LocalDeploymentManager.updateDeploymentResources(deployment.id);
    // Refresh deployment data after resource update
    const updatedDeployment = await LocalDeploymentManager.getDeployment(deployment.id);
    if (updatedDeployment) {
      deployment = updatedDeployment;
    }
  }

  // Get enhanced system metrics
  const systemMetrics = await getSystemMetrics();

  // Get SSL status for the subdomain
  const subdomain = deployment.subdomain || deployment.id?.substring(0, 8);
  const sslStatus = await checkSSLStatus(subdomain);

  // Get additional health info for local deployments
  let healthInfo = null;
  if (deployment.port) {
    try {
      const startTime = Date.now();
      const response = await fetch(`http://localhost:${deployment.port}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      const responseTime = Date.now() - startTime;
      healthInfo = {
        status: response.ok ? 'healthy' : 'unhealthy',
        responseTime,
        lastCheck: new Date().toISOString()
      };
    } catch {
      healthInfo = {
        status: 'unhealthy',
        responseTime: 0,
        lastCheck: new Date().toISOString()
      };
    }
  }

  const info = {
    id: deployment.id,
    projectName: deployment.projectName,
    subdomain,
    framework: deployment.framework,
    status: deployment.status,
    url: deployment.url,
    uptime: deployment.startedAt ? calculateUptime(deployment.startedAt) : 'N/A',
    lastUpdated: deployment.updatedAt || deployment.startedAt || new Date().toISOString(),
    health: healthInfo || {
      status: deployment.healthStatus || 'unknown',
      responseTime: 0,
      lastCheck: new Date().toISOString()
    },
    resources: {
      cpu: deployment.resources?.cpu || systemMetrics.cpu,
      memory: deployment.resources?.memory || systemMetrics.memory.percentage,
      memoryUsed: systemMetrics.memory.used,
      memoryTotal: systemMetrics.memory.total,
      diskUsed: deployment.resources?.diskUsed || systemMetrics.disk.used,
      diskTotal: systemMetrics.disk.total,
      diskUsagePercent: deployment.resources?.diskUsagePercent || systemMetrics.disk.percentage,
    },
    system: {
      uptime: systemMetrics.uptime,
      loadAverage: systemMetrics.loadAverage
    },
    ssl: sslStatus
  };

  if (jsonOutput) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  // Display formatted output
  console.log();
  console.log(chalk.blue.bold('Deployment Information'));
  console.log(chalk.gray('='.repeat(50)));
  console.log();
  
  console.log(chalk.white.bold('Basic Information:'));
  console.log(`  ${chalk.cyan('ID:')} ${info.id}`);
  console.log(`  ${chalk.cyan('Project:')} ${info.projectName}`);
  console.log(`  ${chalk.cyan('Framework:')} ${info.framework}`);
  console.log(`  ${chalk.cyan('Status:')} ${getStatusBadge(info.status)}`);
  console.log(`  ${chalk.cyan('Uptime:')} ${info.uptime}`);
  console.log();

  console.log(chalk.white.bold('Access Information:'));
  console.log(`  ${chalk.cyan('URL:')} ${chalk.blue.underline(info.url)}`);
  console.log(`  ${chalk.cyan('Subdomain:')} ${info.subdomain}`);
  if (deployment.port) {
    console.log(`  ${chalk.cyan('Local Port:')} ${deployment.port}`);
  }
  console.log();

  console.log(chalk.white.bold('Health Status:'));
  console.log(`  ${chalk.cyan('Health:')} ${getHealthBadge(info.health.status)}`);
  console.log(`  ${chalk.cyan('Response Time:')} ${info.health.responseTime}ms`);
  console.log(`  ${chalk.cyan('Last Check:')} ${formatDate(info.health.lastCheck)}`);
  console.log();

  console.log(chalk.white.bold('Resource Usage:'));
  console.log(`  ${chalk.cyan('CPU:')} ${getUsageBar(info.resources.cpu || 0)} ${(info.resources.cpu || 0).toFixed(1)}%`);
  
  if (info.resources.memoryTotal > 0) {
    const memoryGB = (info.resources.memoryUsed / (1024 * 1024 * 1024)).toFixed(2);
    const memoryTotalGB = (info.resources.memoryTotal / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`  ${chalk.cyan('Memory:')} ${getUsageBar(info.resources.memory || 0)} ${memoryGB}GB / ${memoryTotalGB}GB (${(info.resources.memory || 0).toFixed(1)}%)`);
  } else {
    console.log(`  ${chalk.cyan('Memory:')} ${getUsageBar(info.resources.memory || 0)} ${(info.resources.memory || 0).toFixed(1)}%`);
  }
  
  if (info.resources.diskUsed !== undefined) {
    const diskLimitGB = deployment.storageLimit ? (deployment.storageLimit / (1024 * 1024 * 1024)) : 15;
    const diskUsedGB = info.resources.diskUsed / (1024 * 1024 * 1024);
    const diskPercent = info.resources.diskUsagePercent || 0;
    console.log(`  ${chalk.cyan('Disk:')} ${getUsageBar(diskPercent)} ${diskUsedGB.toFixed(2)}GB / ${diskLimitGB}GB (${diskPercent.toFixed(1)}%)`);
  } else {
    console.log(`  ${chalk.cyan('Disk:')} ${chalk.gray('N/A')}`);
  }
  console.log();

  console.log(chalk.white.bold('System Information:'));
  console.log(`  ${chalk.cyan('System Uptime:')} ${formatUptime(info.system.uptime)}`);
  if (info.system.loadAverage) {
    console.log(`  ${chalk.cyan('Load Average:')} ${info.system.loadAverage.map((l: number) => l.toFixed(2)).join(', ')}`);
  }
  console.log();

  console.log(chalk.white.bold('SSL Certificate:'));
  console.log(`  ${chalk.cyan('Enabled:')} ${info.ssl.enabled ? chalk.green('✓ Yes') : chalk.red('✗ No')}`);
  
  if (info.ssl.enabled) {
    if (info.ssl.certificate && info.ssl.certificate !== 'Unable to read certificate details') {
      console.log(`  ${chalk.cyan('Certificate:')} ${info.ssl.certificate}`);
    }
    
    if (info.ssl.issuer) {
      console.log(`  ${chalk.cyan('Issuer:')} ${info.ssl.issuer}`);
    }
    
    if (info.ssl.validFrom) {
      console.log(`  ${chalk.cyan('Valid From:')} ${formatDate(info.ssl.validFrom)}`);
    }
    
    if (info.ssl.expiresAt && info.ssl.expiresAt !== 'Unable to read certificate details') {
      const expiryColor = info.ssl.daysUntilExpiry && info.ssl.daysUntilExpiry < 30 ? chalk.red : 
                         info.ssl.daysUntilExpiry && info.ssl.daysUntilExpiry < 60 ? chalk.yellow : chalk.green;
      
      console.log(`  ${chalk.cyan('Expires:')} ${expiryColor(formatDate(info.ssl.expiresAt))}`);
      
      if (info.ssl.daysUntilExpiry !== undefined) {
        const daysText = info.ssl.daysUntilExpiry > 0 ? 
          `${info.ssl.daysUntilExpiry} days remaining` : 
          `Expired ${Math.abs(info.ssl.daysUntilExpiry)} days ago`;
        console.log(`  ${chalk.cyan('Status:')} ${expiryColor(daysText)}`);
      }
    }
  }
  console.log();

  console.log(chalk.gray('Web Interface: Visit https://forgecli.tech/deployments and enter ID:'), chalk.yellow(info.id));
  console.log();
}

function calculateUptime(startTime: string | Date): string {
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
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function getStatusBadge(status: string): string {
  switch (status.toLowerCase()) {
    case 'running':
    case 'deployed':
      return chalk.green(`● ${status.toUpperCase()}`);
    case 'building':
    case 'deploying':
      return chalk.yellow(`● ${status.toUpperCase()}`);
    case 'stopped':
    case 'paused':
      return chalk.gray(`● ${status.toUpperCase()}`);
    case 'failed':
    case 'error':
      return chalk.red(`● ${status.toUpperCase()}`);
    default:
      return chalk.gray(`● ${status.toUpperCase()}`);
  }
}

function getHealthBadge(health: string): string {
  switch (health.toLowerCase()) {
    case 'healthy':
      return chalk.green('✓ HEALTHY');
    case 'unhealthy':
      return chalk.red('✗ UNHEALTHY');
    default:
      return chalk.gray('? UNKNOWN');
  }
}

function getUsageBar(percentage: number): string {
  const barLength = 20;
  const filledLength = Math.round((percentage / 100) * barLength);
  const emptyLength = barLength - filledLength;
  
  let color = chalk.green;
  if (percentage > 70) color = chalk.yellow;
  if (percentage > 90) color = chalk.red;
  
  return color('█'.repeat(filledLength)) + chalk.gray('█'.repeat(emptyLength)) + ' ';
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}
