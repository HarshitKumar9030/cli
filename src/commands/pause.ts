import chalk from 'chalk';
import { Command } from 'commander';
import { LocalDeploymentManager } from '../services/localDeployment';
import { ConfigService } from '../services/config';
import { execSync } from 'child_process';

export const pauseCommand = new Command('pause')
  .description('Pause a local deployment')
  .argument('[deployment-id]', 'Deployment ID to pause (optional, defaults to current project)')
  .action(async (deploymentId) => {
    try {
      const configService = new ConfigService();
      
      // If no deployment ID provided, try to get from current project
      if (!deploymentId) {
        const config = await configService.getConfig();
        deploymentId = config.deploymentId;
        
        if (!deploymentId) {
          console.log(chalk.red('No deployment ID specified and no current project deployment found'));
          console.log(chalk.gray('Usage: forge pause <deployment-id>'));
          process.exit(1);
        }
      }

      console.log(chalk.blue(`Pausing deployment: ${deploymentId}`));
      
      const deployment = await LocalDeploymentManager.getDeployment(deploymentId);
      if (!deployment) {
        console.log(chalk.red('Local deployment not found'));
        console.log(chalk.gray('Use "forge status" to see available deployments'));
        process.exit(1);
      }

      if (deployment.status === 'stopped' || deployment.status === 'paused') {
        console.log(chalk.yellow(`Deployment is already ${deployment.status}`));
        return;
      }

      // Pause PM2 process
      const appName = `forge-${deploymentId}`;
      try {
        execSync(`pm2 stop ${appName}`, { stdio: 'pipe' });
        deployment.status = 'paused';
        await LocalDeploymentManager.saveDeployment(deployment);
        console.log(chalk.green('Deployment paused successfully'));
        console.log(chalk.gray('Use "forge resume" to resume the deployment'));
      } catch (error) {
        console.log(chalk.red(`Failed to pause deployment: ${error}`));
      }

    } catch (error) {
      console.log(chalk.red(`Failed to pause deployment: ${error}`));
      process.exit(1);
    }
  });

export const resumeCommand = new Command('resume')
  .description('Resume a paused deployment')
  .argument('[deployment-id]', 'Deployment ID to resume (optional, defaults to current project)')
  .action(async (deploymentId) => {
    try {
      const configService = new ConfigService();
      
      // If no deployment ID provided, try to get from current project
      if (!deploymentId) {
        const config = await configService.getConfig();
        deploymentId = config.deploymentId;
        
        if (!deploymentId) {
          console.log(chalk.red('No deployment ID specified and no current project deployment found'));
          console.log(chalk.gray('Usage: forge resume <deployment-id>'));
          process.exit(1);
        }
      }

      console.log(chalk.blue(`Resuming deployment: ${deploymentId}`));
      
      const deployment = await LocalDeploymentManager.getDeployment(deploymentId);
      if (!deployment) {
        console.log(chalk.red('Local deployment not found'));
        console.log(chalk.gray('Use "forge status" to see available deployments'));
        process.exit(1);
      }

      if (deployment.status === 'running') {
        console.log(chalk.yellow('Deployment is already running'));
        return;
      }

      if (deployment.status === 'stopped') {
        console.log(chalk.yellow('Deployment is stopped. Use "forge deploy" to restart it.'));
        return;
      }

      // Resume PM2 process
      const appName = `forge-${deploymentId}`;
      try {
        execSync(`pm2 start ${appName}`, { stdio: 'pipe' });
        deployment.status = 'running';
        await LocalDeploymentManager.saveDeployment(deployment);
        console.log(chalk.green('Deployment resumed successfully'));
        console.log(chalk.gray(`Local URL: http://localhost:${deployment.port}`));
        console.log(chalk.gray(`Public URL: ${deployment.url}`));
      } catch (error) {
        console.log(chalk.red(`Failed to resume deployment: ${error}`));
      }

    } catch (error) {
      console.log(chalk.red(`Failed to resume deployment: ${error}`));
      process.exit(1);
    }
  });
