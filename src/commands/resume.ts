import chalk from 'chalk';
import { Command } from 'commander';
import { LocalDeploymentManager } from '../services/localDeployment';
import { ConfigService } from '../services/config';
import { execSync } from 'child_process';

export const resumeCommand = new Command('resume')
  .description('Resume a paused local deployment')
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
        console.log(chalk.yellow('Deployment is stopped. Use "forge deploy" to restart it completely.'));
        return;
      }

      // Resume PM2 process
      const appName = `forge-${deploymentId}`;
      try {
        execSync(`pm2 start ${appName}`, { stdio: 'pipe' });
        deployment.status = 'running';
        await LocalDeploymentManager.saveDeployment(deployment);
        console.log(chalk.green('Deployment resumed successfully'));
        console.log(chalk.gray(`Access your app at: http://localhost:${deployment.port}`));
      } catch (error) {
        console.log(chalk.red(`Failed to resume deployment: ${error}`));
        console.log(chalk.gray('You may need to redeploy the application'));
      }

    } catch (error) {
      console.log(chalk.red(`Failed to resume deployment: ${error}`));
      process.exit(1);
    }
  });
