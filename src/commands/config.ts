import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ConfigService } from '../services/config';
import { ForgeConfig } from '../types';

export const configCommand = new Command('config')
  .description('Manage configuration settings')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--get <key>', 'Get a configuration value')
  .option('--list', 'List all configuration values')
  .option('--global', 'Operate on global configuration')
  .option('--project', 'Operate on project configuration')
  .action(async (options) => {
    try {
      const configService = new ConfigService();
      
      if (options.list) {
        await listConfiguration(configService, options.global, options.project);
      } else if (options.get) {
        await getConfiguration(configService, options.get, options.global, options.project);
      } else if (options.set) {
        await setConfiguration(configService, options.set, options.global, options.project);
      } else {
        // Interactive configuration
        await interactiveConfig(configService);
      }
    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

async function listConfiguration(configService: ConfigService, global: boolean, project: boolean): Promise<void> {
  if (global || (!global && !project)) {
    console.log(chalk.blue('Global Configuration:'));
    const globalConfig = await configService.loadGlobalConfig();
    if (globalConfig) {
      Object.entries(globalConfig).forEach(([key, value]) => {
        if (key === 'apiKey' && value) {
          console.log(`  ${chalk.cyan(key)}: ${chalk.gray('***masked***')}`);
        } else {
          console.log(`  ${chalk.cyan(key)}: ${chalk.white(value)}`);
        }
      });
    } else {
      console.log(chalk.gray('  No global configuration found'));
    }
    console.log();
  }

  if (project || (!global && !project)) {
    console.log(chalk.blue('Project Configuration:'));
    const projectConfig = await configService.loadProjectConfig();
    if (projectConfig) {
      Object.entries(projectConfig).forEach(([key, value]) => {
        console.log(`  ${chalk.cyan(key)}: ${chalk.white(value)}`);
      });
    } else {
      console.log(chalk.gray('  No project configuration found'));
      console.log(chalk.gray('  Run "forge init" to initialize a project'));
    }
  }
}

async function getConfiguration(configService: ConfigService, key: string, global: boolean, project: boolean): Promise<void> {
  let config: ForgeConfig | null = null;
  
  if (global) {
    config = await configService.loadGlobalConfig();
  } else if (project) {
    config = await configService.loadProjectConfig();
  } else {
    // Try project first, then global
    config = await configService.loadProjectConfig() || await configService.loadGlobalConfig();
  }

  if (!config) {
    console.log(chalk.yellow('No configuration found'));
    return;
  }

  const value = (config as any)[key];
  if (value !== undefined) {
    if (key === 'apiKey' && value) {
      console.log(chalk.gray('***masked***'));
    } else {
      console.log(chalk.white(value));
    }
  } else {
    console.log(chalk.yellow(`Configuration key "${key}" not found`));
  }
}

async function setConfiguration(configService: ConfigService, keyValue: string, global: boolean, project: boolean): Promise<void> {
  const [key, ...valueParts] = keyValue.split('=');
  const value = valueParts.join('=');
  
  if (!key || !value) {
    console.log(chalk.red('Error: Invalid format. Use --set key=value'));
    return;
  }

  if (global) {
    const existingConfig = await configService.loadGlobalConfig() || {};
    (existingConfig as any)[key] = value;
    await configService.saveGlobalConfig(existingConfig);
    console.log(chalk.green(`Global configuration updated: ${key}`));
  } else if (project) {
    const existingConfig = await configService.loadProjectConfig();
    if (!existingConfig) {
      console.log(chalk.red('Error: No project configuration found'));
      console.log('Run "forge init" to initialize a project');
      return;
    }
    (existingConfig as any)[key] = value;
    await configService.saveProjectConfig(existingConfig);
    console.log(chalk.green(`Project configuration updated: ${key}`));
  } else {
    console.log(chalk.yellow('Please specify --global or --project flag'));
  }
}

async function interactiveConfig(configService: ConfigService): Promise<void> {
  console.log(chalk.blue('Interactive Configuration'));
  console.log(chalk.gray('Configure your Forge CLI settings'));
  console.log();

  const { configType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'configType',
      message: 'Which configuration would you like to modify?',
      choices: [
        { name: 'Global Configuration', value: 'global' },
        { name: 'Project Configuration', value: 'project' },
        { name: 'View All Settings', value: 'view' }
      ]
    }
  ]);

  if (configType === 'view') {
    await listConfiguration(configService, false, false);
    return;
  }

  if (configType === 'global') {
    const globalConfig = await configService.loadGlobalConfig() || {};
    
    const { apiUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiUrl',
        message: 'API URL:',
        default: globalConfig.apiUrl || 'https://api.forgecli.tech'
      }
    ]);

    await configService.saveGlobalConfig({ ...globalConfig, apiUrl });
    console.log(chalk.green('Global configuration saved'));
  } else if (configType === 'project') {
    const projectConfig = await configService.loadProjectConfig();
    if (!projectConfig) {
      console.log(chalk.red('Error: No project configuration found'));
      console.log('Run "forge init" to initialize a project');
      return;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: projectConfig.projectName
      },
      {
        type: 'input',
        name: 'buildCommand',
        message: 'Build command:',
        default: projectConfig.buildCommand
      },
      {
        type: 'input',
        name: 'outputDirectory',
        message: 'Output directory:',
        default: projectConfig.outputDirectory
      }
    ]);

    const updatedConfig = { ...projectConfig, ...answers };
    await configService.saveProjectConfig(updatedConfig);
    console.log(chalk.green('Project configuration saved'));
  }
}
