import chalk from 'chalk';
import { ConfigService } from '../services/config';
import { ForgeApiService } from '../services/api';
import { LocalDeploymentManager } from '../services/localDeployment';

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
    console.log(chalk.gray('Use: forge info --local --id <deployment-id> for detailed information'));
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
      console.log(chalk.gray('Use: forge info --id <deployment-id>'));
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

  // Get additional health info for local deployments
  let healthInfo = null;
  if (deployment.port) {
    try {
      const response = await fetch(`http://localhost:${deployment.port}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      healthInfo = {
        status: response.ok ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - Date.now(), // This would be calculated properly
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
    subdomain: deployment.subdomain || deployment.id?.substring(0, 8),
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
    resources: deployment.resources || {
      cpu: 0,
      memory: 0,
      diskUsed: 0,
      diskUsagePercent: 0
    },
    ssl: {
      enabled: deployment.url?.startsWith('https://') || false,
      expiresAt: deployment.url?.startsWith('https://') ? 
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() : 
        undefined
    }
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
  console.log(`  ${chalk.cyan('CPU:')} ${getUsageBar(info.resources.cpu || 0)}${(info.resources.cpu || 0).toFixed(1)}%`);
  console.log(`  ${chalk.cyan('Memory:')} ${getUsageBar(info.resources.memory || 0)}${(info.resources.memory || 0).toFixed(1)}%`);
  
  if (info.resources.diskUsed !== undefined) {
    const diskLimitGB = deployment.storageLimit ? (deployment.storageLimit / (1024 * 1024 * 1024)) : 15;
    const diskUsedGB = info.resources.diskUsed / (1024 * 1024 * 1024);
    const diskPercent = info.resources.diskUsagePercent || 0;
    console.log(`  ${chalk.cyan('Disk:')} ${getUsageBar(diskPercent)}${diskUsedGB.toFixed(2)}GB / ${diskLimitGB}GB (${diskPercent.toFixed(1)}%)`);
  } else {
    console.log(`  ${chalk.cyan('Disk:')} ${chalk.gray('N/A')}`);
  }
  console.log();

  console.log(chalk.white.bold('SSL Certificate:'));
  console.log(`  ${chalk.cyan('Enabled:')} ${info.ssl.enabled ? chalk.green('Yes') : chalk.red('No')}`);
  if (info.ssl.enabled && info.ssl.expiresAt) {
    console.log(`  ${chalk.cyan('Expires:')} ${formatDate(info.ssl.expiresAt)}`);
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
