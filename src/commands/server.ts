import { Command } from 'commander';
import { execSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

export const serverCommand = new Command('server')
  .description('Manage the Forge API server')
  .addCommand(
    new Command('start')
      .description('Start the API server with PM2')
      .option('--dev', 'Start in development mode')
      .action(async (options) => {
        try {
          console.log(chalk.blue('Starting Forge API Server...'));

          if (options.dev) {
            console.log(chalk.yellow('Starting in development mode'));
            execSync('npm run server:dev', { stdio: 'inherit' });
          } else {
            // Ensure build is up to date
            console.log(chalk.gray('Building CLI...'));
            execSync('npm run build', { stdio: 'inherit' });

            // Start with PM2
            console.log(chalk.gray('Starting with PM2...'));
            execSync('npm run server:start', { stdio: 'inherit' });

            console.log();
            console.log(chalk.green('✅ Forge API Server started successfully'));
            console.log(chalk.gray('Check status: npm run server:status'));
            console.log(chalk.gray('View logs: npm run server:logs'));
          }
        } catch (error) {
          console.error(chalk.red('Failed to start API server:'), error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop the API server')
      .action(async () => {
        try {
          console.log(chalk.yellow('Stopping Forge API Server...'));
          execSync('npm run server:stop', { stdio: 'inherit' });
          console.log(chalk.green('✅ Forge API Server stopped'));
        } catch (error) {
          console.error(chalk.red('Failed to stop API server:'), error);
        }
      })
  )
  .addCommand(
    new Command('restart')
      .description('Restart the API server')
      .action(async () => {
        try {
          console.log(chalk.blue('Restarting Forge API Server...'));
          execSync('npm run server:restart', { stdio: 'inherit' });
          console.log(chalk.green('✅ Forge API Server restarted'));
        } catch (error) {
          console.error(chalk.red('Failed to restart API server:'), error);
        }
      })
  )
  .addCommand(
    new Command('status')
      .description('Check API server status')
      .action(async () => {
        try {
          console.log(chalk.blue('Forge API Server Status:'));
          execSync('npm run server:status', { stdio: 'inherit' });
        } catch (error) {
          console.log(chalk.red('API server is not running'));
        }
      })
  )
  .addCommand(
    new Command('logs')
      .description('View API server logs')
      .option('--follow', 'Follow log output')
      .action(async (options) => {
        try {
          if (options.follow) {
            execSync('npm run server:logs -- --follow', { stdio: 'inherit' });
          } else {
            execSync('npm run server:logs', { stdio: 'inherit' });
          }
        } catch (error) {
          console.error(chalk.red('Failed to get logs:'), error);
        }
      })
  )
  .addCommand(
    new Command('health')
      .description('Check API server health')
      .action(async () => {
        try {
          console.log(chalk.blue('Checking API server health...'));
          
          const response = await fetch('http://localhost:8080/health', {
            signal: AbortSignal.timeout(5000)
          });
          
          if (response.ok) {
            const data = await response.json() as { status: string; timestamp: string };
            console.log(chalk.green('✅ API server is healthy'));
            console.log(chalk.gray(`Status: ${data.status}`));
            console.log(chalk.gray(`Timestamp: ${data.timestamp}`));
          } else {
            console.log(chalk.red('❌ API server is unhealthy'));
            console.log(chalk.gray(`Status: ${response.status}`));
          }
        } catch (error) {
          console.log(chalk.red('❌ API server is unreachable'));
          console.log(chalk.gray('Run "forge server start" to start the server'));
        }
      })
  );
