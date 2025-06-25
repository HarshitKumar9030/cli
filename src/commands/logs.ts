import { Command } from 'commander';
import chalk from 'chalk';
import { ForgeApiService } from '../services/api';
import { ConfigService } from '../services/config';
import { LocalDeploymentManager } from '../services/localDeployment';
import { execSync } from 'child_process';
import path from 'path';

export const logsCommand = new Command('logs')
  .description('View application logs')
  .argument('[deployment-id]', 'Deployment ID (optional, defaults to current project)')
  .option('-f, --follow', 'Follow log output')
  .option('-t, --tail <lines>', 'Number of lines to show from the end', '100')
  .option('--error', 'Show only error logs')
  .option('--access', 'Show only access logs')
  .option('--local', 'Show only local PM2 logs')
  .option('--remote', 'Show only remote API logs')
  .action(async (deploymentId, options) => {
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

        // Show both local PM2 logs and remote API logs
        if (!options.remote) {
          console.log(chalk.blue('📁 Local PM2 Logs:'));
          await showLocalLogs(config.deploymentId, options);
        }

        if (!options.local) {
          console.log(chalk.blue('🌐 Remote API Logs:'));
          try {
            const response = await api.getDeploymentLogs(config.deploymentId);
            const logs = response.data?.logs || [];
            
            if (logs.length === 0) {
              console.log(chalk.yellow('No remote logs found'));
            } else {
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
              console.log(chalk.green(`Showing last ${filteredLogs.length} remote log entries`));
            }
          } catch (apiError) {
            console.log(chalk.yellow(`⚠️  Remote logs unavailable: ${apiError}`));
            console.log(chalk.gray('API might be down or deployment not found remotely'));
            if (options.local) {
              console.log(chalk.gray('Showing local logs only'));
            }
          }
        }
      }
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

async function showLocalLogs(deploymentId: string, options: any): Promise<void> {
  try {
    // Check if deployment exists locally
    const deployment = await LocalDeploymentManager.getDeployment(deploymentId);
    if (!deployment) {
      console.log(chalk.yellow('Local deployment not found'));
      return;
    }

    const appName = `forge-${deploymentId}`;
    const logTail = options.tail || '100';

    try {
      // Try to get PM2 logs
      console.log(chalk.gray(`PM2 Process: ${appName}`));
      
      if (options.error) {
        // Show error logs only
        const errorLogs = execSync(`pm2 logs ${appName} --err --lines ${logTail}`, { encoding: 'utf8' });
        console.log(errorLogs);
      } else {
        // Show all logs
        const allLogs = execSync(`pm2 logs ${appName} --lines ${logTail}`, { encoding: 'utf8' });
        console.log(allLogs);
      }
    } catch (pm2Error) {
      // PM2 logs failed, try to show log files directly
      console.log(chalk.yellow('PM2 logs not available, checking log files...'));
      
      const logDir = path.join(process.cwd(), 'logs');
      const errorFile = path.join(logDir, `${deploymentId}-error.log`);
      const outFile = path.join(logDir, `${deploymentId}-out.log`);
      const combinedFile = path.join(logDir, `${deploymentId}-combined.log`);
      
      const fs = await import('fs-extra');
      
      if (await fs.pathExists(combinedFile)) {
        console.log(chalk.gray(`Reading log file: ${combinedFile}`));
        const logs = await fs.readFile(combinedFile, 'utf8');
        const lines = logs.split('\n').slice(-parseInt(logTail));
        console.log(lines.join('\n'));
      } else if (await fs.pathExists(outFile)) {
        console.log(chalk.gray(`Reading output log: ${outFile}`));
        const logs = await fs.readFile(outFile, 'utf8');
        const lines = logs.split('\n').slice(-parseInt(logTail));
        console.log(lines.join('\n'));
        
        if (await fs.pathExists(errorFile)) {
          console.log(chalk.red('\nError Logs:'));
          const errorLogs = await fs.readFile(errorFile, 'utf8');
          const errorLines = errorLogs.split('\n').slice(-parseInt(logTail));
          console.log(errorLines.join('\n'));
        }
      } else {
        console.log(chalk.yellow('No local log files found'));
        console.log(chalk.gray(`Expected log files in: ${logDir}`));
      }
    }
  } catch (error) {
    console.log(chalk.red(`Error reading local logs: ${error}`));
  }
}
