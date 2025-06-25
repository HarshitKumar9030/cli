import { Command } from 'commander';
import chalk from 'chalk';
import { ForgeApiService } from '../services/api';
import { ConfigService } from '../services/config';

export const logsCommand = new Command('logs')
  .description('View application logs')
  .option('-f, --follow', 'Follow log output')
  .option('-t, --tail <lines>', 'Number of lines to show from the end', '100')
  .option('--error', 'Show only error logs')
  .option('--access', 'Show only access logs')
  .action(async (options) => {
    try {
      const configService = new ConfigService();
      const config = await configService.loadProjectConfig();
      if (!config) {
        console.log(chalk.red('Error: Not in a Forge project directory'));
        console.log('Run "forge init" to initialize a project');
        process.exit(1);
      }

      const globalConfig = await configService.loadGlobalConfig();
      if (!globalConfig?.apiKey) {
        console.log(chalk.red('Error: Not authenticated'));
        console.log('Run "forge login" to authenticate');
        process.exit(1);
      }

      console.log(chalk.blue('Fetching logs...'));

      const api = new ForgeApiService();
      api.setApiKey(globalConfig.apiKey);
      
      const logOptions = {
        tail: parseInt(options.tail),
        follow: options.follow,
        type: options.error ? 'error' : options.access ? 'access' : 'all'
      };

      if (options.follow) {
        console.log(chalk.yellow('Following logs (Press Ctrl+C to stop)...'));
        console.log(chalk.gray('---'));
        
        // Simulate log streaming (in a real implementation, this would be a WebSocket or SSE connection)
        const interval = setInterval(async () => {
          try {
            if (config.deploymentId) {
              const response = await api.getDeploymentLogs(config.deploymentId);
              const logs = response.data?.logs || [];
              logs.slice(-parseInt(options.tail)).forEach((log: any) => {
                const timestamp = new Date(log.timestamp).toISOString();
                const level = log.level === 'error' ? chalk.red(log.level) : 
                             log.level === 'warn' ? chalk.yellow(log.level) : 
                             chalk.white(log.level);
                console.log(`${chalk.gray(timestamp)} ${level} ${log.message}`);
              });
            }
          } catch (error) {
            console.log(chalk.red(`Error fetching logs: ${error}`));
            clearInterval(interval);
          }
        }, 2000);

        process.on('SIGINT', () => {
          clearInterval(interval);
          console.log(chalk.yellow('\nStopped following logs'));
          process.exit(0);
        });
      } else {
        if (!config.deploymentId) {
          console.log(chalk.yellow('No deployment found. Deploy your app first with "forge deploy"'));
          return;
        }

        const response = await api.getDeploymentLogs(config.deploymentId);
        const logs = response.data?.logs || [];
        
        if (logs.length === 0) {
          console.log(chalk.yellow('No logs found'));
          return;
        }

        const filteredLogs = logs.slice(-parseInt(options.tail));

        console.log(chalk.gray('---'));
        filteredLogs.forEach((log: any) => {
          const timestamp = new Date(log.timestamp).toISOString();
          const level = log.level === 'error' ? chalk.red(log.level) : 
                       log.level === 'warn' ? chalk.yellow(log.level) : 
                       chalk.white(log.level);
          console.log(`${chalk.gray(timestamp)} ${level} ${log.message}`);
        });
        console.log(chalk.gray('---'));
        console.log(chalk.green(`Showing last ${filteredLogs.length} log entries`));
      }
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });
