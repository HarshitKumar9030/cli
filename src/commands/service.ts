import chalk from 'chalk';
import { Command } from 'commander';
import { AutoRestartService } from '../services/autoRestart';
import { getSystemInfo } from '../utils/system';

export const serviceCommand = new Command('service')
  .description('Manage Forge CLI service')
  .option('--start', 'Start the auto-restart service')
  .option('--stop', 'Stop the auto-restart service')
  .option('--restart', 'Restart the auto-restart service')
  .option('--status', 'Show service status')
  .option('--daemon', 'Run as service daemon (internal use)')
  .action(async (options) => {
    try {
      if (options.daemon) {
        // This is used internally by the service
        await AutoRestartService.startServiceDaemon();
        return;
      }

      if (options.start) {
        await startService();
        return;
      }

      if (options.stop) {
        await stopService();
        return;
      }

      if (options.restart) {
        await restartService();
        return;
      }

      if (options.status) {
        await showServiceStatus();
        return;
      }

      // Default: show service status
      await showServiceStatus();

    } catch (error) {
      console.log(chalk.red(`Service operation failed: ${error}`));
      process.exit(1);
    }
  });

async function startService(): Promise<void> {
  console.log(chalk.cyan('Starting Forge CLI service...'));
  
  try {
    await AutoRestartService.startAutoRestart();
    console.log(chalk.green('Service started successfully'));
  } catch (error) {
    console.log(chalk.red(`Failed to start service: ${error}`));
    process.exit(1);
  }
}

async function stopService(): Promise<void> {
  console.log(chalk.cyan('Stopping Forge CLI service...'));
  
  try {
    await AutoRestartService.stopAutoRestart();
    console.log(chalk.green('Service stopped successfully'));
  } catch (error) {
    console.log(chalk.red(`Failed to stop service: ${error}`));
    process.exit(1);
  }
}

async function restartService(): Promise<void> {
  console.log(chalk.cyan('Restarting Forge CLI service...'));
  
  try {
    await AutoRestartService.stopAutoRestart();
    console.log(chalk.gray('Service stopped'));
    
    // Wait a moment before restarting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await AutoRestartService.startAutoRestart();
    console.log(chalk.green('Service restarted successfully'));
  } catch (error) {
    console.log(chalk.red(`Failed to restart service: ${error}`));
    process.exit(1);
  }
}

async function showServiceStatus(): Promise<void> {
  console.log(chalk.blue('Forge CLI Service Status'));
  console.log();

  const systemInfo = getSystemInfo();
  const autoRestartEnabled = await AutoRestartService.isAutoRestartEnabled();

  console.log(chalk.blue('Service Information:'));
  console.log(`  ${chalk.cyan('Auto-restart:')} ${autoRestartEnabled ? chalk.green('Configured') : chalk.red('Not configured')}`);
  console.log(`  ${chalk.cyan('Platform:')} ${systemInfo.platform}`);
  console.log(`  ${chalk.cyan('System uptime:')} ${Math.floor(systemInfo.uptime / 3600)} hours`);
  console.log();

  if (autoRestartEnabled) {
    console.log(chalk.green('✓ Auto-restart service is configured'));
    console.log(chalk.gray('  The CLI will automatically restart after system reboots'));
    console.log();
    console.log(chalk.blue('Available commands:'));
    console.log(chalk.gray('  forge service --start    Start the service'));
    console.log(chalk.gray('  forge service --stop     Stop the service'));
    console.log(chalk.gray('  forge service --restart  Restart the service'));
  } else {
    console.log(chalk.yellow('⚠ Auto-restart service is not configured'));
    console.log(chalk.gray('  Run "forge setup --auto-restart" to enable auto-restart'));
  }
}
