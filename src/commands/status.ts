import chalk from 'chalk';
import { ConfigService } from '../services/config';
import { ForgeApiService } from '../services/api';
import { LocalDeploymentManager } from '../services/localDeployment';
import { StatusOptions } from '../types';

export async function statusCommand(options: StatusOptions): Promise<void> {
  console.log(chalk.blue.bold('Checking deployment status...'));

  const configService = new ConfigService();
  const config = await configService.getConfig();

  if (!config.apiKey) {
    console.error(chalk.red('Not logged in. Please run: forge login'));
    process.exit(1);
  }

  const apiService = new ForgeApiService(config.apiUrl);
  apiService.setApiKey(config.apiKey);

  try {
    let deployments;

    if (options.deploymentId) {
      // Get specific deployment
      const response = await apiService.getDeployments({ id: options.deploymentId });
      if (response.success) {
        deployments = response.data?.deployments || [];
      } else {
        throw new Error(response.error?.message || 'Failed to fetch deployment');
      }
    } else if (options.all) {
      // Get all deployments
      const response = await apiService.getDeployments();
      if (response.success) {
        deployments = response.data?.deployments || [];
      } else {
        throw new Error(response.error?.message || 'Failed to fetch deployments');
      }
    } else {
      // Get current project deployment
      if (!config.deploymentId) {
        console.error(chalk.red('No deployment found for current project. Use --all to see all deployments.'));
        process.exit(1);
      }

      const response = await apiService.getDeployments({ id: config.deploymentId });
      if (response.success) {
        deployments = response.data?.deployments || [];
      } else {
        throw new Error(response.error?.message || 'Failed to fetch deployment');
      }
    }

    if (deployments.length === 0) {
      console.log(chalk.yellow('No deployments found'));
      return;
    }

    console.log();
    deployments.forEach((deployment: any) => {
      const statusColor = getStatusColor(deployment.status);
      const healthColor = getHealthColor(deployment.healthStatus);

      console.log(chalk.white.bold(`${deployment.projectName} (${deployment.id})`));
      console.log(chalk.gray(`  URL: ${deployment.url}`));
      console.log(chalk.gray(`  Framework: ${deployment.framework}`));
      console.log(`  Status: ${statusColor(deployment.status)}`);
      console.log(`  Health: ${healthColor(deployment.healthStatus)}`);
      console.log(chalk.gray(`  Created: ${new Date(deployment.createdAt).toLocaleString()}`));
      
      if (deployment.deployedAt) {
        console.log(chalk.gray(`  Deployed: ${new Date(deployment.deployedAt).toLocaleString()}`));
      }
      
      console.log();
    });

    // Also show local deployment status
    console.log(chalk.blue.bold('Local Deployments:'));
    const localDeployments = await LocalDeploymentManager.listDeployments();
    
    if (localDeployments.length === 0) {
      console.log(chalk.gray('  No local deployments found'));
    } else {
      localDeployments.forEach(localDep => {
        const localStatusColor = getLocalStatusColor(localDep.status);
        
        console.log(chalk.white.bold(`  ${localDep.projectName} (${localDep.id})`));
        console.log(chalk.gray(`    Project Path: ${localDep.projectPath}`));
        console.log(chalk.gray(`    Local URL: http://localhost:${localDep.port}`));
        console.log(chalk.gray(`    Public URL: ${localDep.url}`));
        console.log(`    Status: ${localStatusColor(localDep.status)}`);
        console.log(chalk.gray(`    Framework: ${localDep.framework}`));
        
        if (localDep.startedAt) {
          console.log(chalk.gray(`    Started: ${new Date(localDep.startedAt).toLocaleString()}`));
        }
        
        if (localDep.pid) {
          console.log(chalk.gray(`    Process ID: ${localDep.pid}`));
        }

        // Show available actions based on status
        if (localDep.status === 'running') {
          console.log(chalk.blue(`    Actions: forge pause ${localDep.id} | forge stop ${localDep.id}`));
        } else if (localDep.status === 'paused') {
          console.log(chalk.blue(`    Actions: forge resume ${localDep.id} | forge stop ${localDep.id}`));
        } else if (localDep.status === 'stopped') {
          console.log(chalk.blue(`    Actions: forge deploy (to restart)`));
        }
        
        console.log();
      });
    }

  } catch (error) {
    console.error(chalk.red('Failed to fetch status:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'deployed':
      return chalk.green;
    case 'building':
    case 'deploying':
      return chalk.yellow;
    case 'failed':
    case 'cancelled':
      return chalk.red;
    default:
      return chalk.gray;
  }
}

function getHealthColor(health: string) {
  switch (health.toLowerCase()) {
    case 'healthy':
      return chalk.green;
    case 'unhealthy':
      return chalk.red;
    default:
      return chalk.gray;
  }
}

function getLocalStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'running':
      return chalk.green;
    case 'paused':
      return chalk.yellow;
    case 'stopped':
      return chalk.gray;
    case 'failed':
      return chalk.red;
    default:
      return chalk.gray;
  }
}
