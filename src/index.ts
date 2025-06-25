#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { loginCommand } from './commands/login';
import { signupCommand } from './commands/signup';
import { deployCommand } from './commands/deploy';
import { statusCommand } from './commands/status';
import { logsCommand } from './commands/logs';
import { configCommand } from './commands/config';
import { setupCommand } from './commands/setup';
import { serviceCommand } from './commands/service';
import { stopCommand } from './commands/stop';
import { pauseCommand } from './commands/pause';
import { resumeCommand } from './commands/resume';
import { infraCommand } from './commands/infra';
import { AutoRestartService } from './services/autoRestart';
import { checkVersion } from './utils/version';

const program = new Command();

program
  .name('forge')
  .description('Command-line interface for the Forge deployment platform')
  .version('1.0.0')
  .option('--service', 'Run as background service (internal use)')
  .hook('preAction', async () => {
    await checkVersion();
  });

// Handle service daemon mode
if (process.argv.includes('--service')) {
  AutoRestartService.startServiceDaemon().catch(error => {
    console.error(chalk.red(`Service daemon failed: ${error}`));
    process.exit(1);
  });
} else {
  // Add commands as sub-commands
  // Commands that export Command objects
  program.addCommand(deployCommand);
  program.addCommand(logsCommand);
  program.addCommand(configCommand);
  program.addCommand(setupCommand);
  program.addCommand(serviceCommand);
  program.addCommand(stopCommand);
  program.addCommand(pauseCommand);
  program.addCommand(resumeCommand);
  program.addCommand(infraCommand);

  // Commands that export functions need to be wrapped
  program
    .command('init')
    .description('Initialize a new Forge project')
    .option('-t, --template <template>', 'Project template')
    .option('-y, --yes', 'Skip interactive prompts')
    .action(initCommand);

  program
    .command('login')
    .description('Authenticate with Forge')
    .option('-a, --api-url <url>', 'API URL')
    .action(loginCommand);

  program
    .command('signup')
    .description('Create a new Forge account')
    .option('-e, --email <email>', 'Email address')
    .option('-u, --username <username>', 'Username (optional)')
    .option('-a, --api-url <url>', 'API URL')
    .action(signupCommand);

  program
    .command('status')
    .description('Check deployment status')
    .option('-d, --deployment-id <id>', 'Specific deployment ID')
    .action(statusCommand);

  program.parse();

  if (!process.argv.slice(2).length) {
    console.log(chalk.blue('Forge CLI v1.0.0'));
    console.log(chalk.gray('Command-line interface for the Forge deployment platform'));
    console.log();
    program.help();
  }
}
