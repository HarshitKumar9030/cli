import chalk from 'chalk';
import { Command } from 'commander';
import { LocalDeploymentManager } from '../services/localDeployment';
import { ConfigService } from '../services/config';

export const stopCommand = new Command('stop')
  .description('Stop a local deployment')
  .argument('[deployment-id]', 'Deployment ID to stop (optional, defaults to current project)')
  .action(async (deploymentId) => {
    try {
      const configService = new ConfigService();
      
      // If no deployment ID provided, try to get from current project
      if (!deploymentId) {
        const config = await configService.getConfig();
        deploymentId = config.deploymentId;
        
        if (!deploymentId) {
          console.log(chalk.red('No deployment ID specified and no current project deployment found'));
          console.log(chalk.gray('Usage: forge stop <deployment-id>'));
          process.exit(1);
        }
      }

      console.log(chalk.blue(`Stopping deployment: ${deploymentId}`));
      
      const deployment = await LocalDeploymentManager.getDeployment(deploymentId);
      if (!deployment) {
        console.log(chalk.red('Local deployment not found'));
        console.log(chalk.gray('Use "forge status" to see available deployments'));
        process.exit(1);
      }

      if (deployment.status === 'stopped') {
        console.log(chalk.yellow('Deployment is already stopped'));
        return;
      }

      await LocalDeploymentManager.stopDeployment(deploymentId);
      console.log(chalk.green('Deployment stopped successfully'));

    } catch (error) {
      console.log(chalk.red(`Failed to stop deployment: ${error}`));
      process.exit(1);
    }
  });
