import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { WorkspaceManager } from '../services/workspaceManager';
import { ConfigService } from '../services/config';

export const workspaceCommand = new Command('workspace')
  .description('Manage workspace configuration and templates')
  .addCommand(
    new Command('init')
      .description('Initialize workspace configuration for complex builds')
      .option('--template <template>', 'Use a predefined template')
      .option('--interactive', 'Interactive configuration setup')
      .action(async (options) => {
        try {
          const projectPath = process.cwd();
          const configService = new ConfigService();
          const workspaceManager = new WorkspaceManager(projectPath);

          console.log(chalk.blue('Forge Workspace Configuration'));
          console.log(chalk.gray('Setting up deployment workflow for your project...'));
          console.log();

          let workspaceSetup;

          if (options.template) {
            const templates = WorkspaceManager.getWorkspaceTemplates();
            const template = templates[options.template];
            
            if (!template) {
              console.log(chalk.red(`Template "${options.template}" not found`));
              console.log(chalk.gray('Available templates:'));
              Object.keys(templates).forEach(name => {
                console.log(`  • ${name}`);
              });
              process.exit(1);
            }

            const baseSetup = await workspaceManager.analyzeWorkspace();
            workspaceSetup = {
              ...baseSetup,
              ...template,
              preDeploySteps: template.preDeploySteps || [],
              buildSteps: template.buildSteps || [],
              postDeploySteps: template.postDeploySteps || []
            };

            console.log(chalk.green(`Using template: ${options.template}`));
          } else if (options.interactive) {
            workspaceSetup = await workspaceManager.interactiveSetup();
          } else {
            workspaceSetup = await workspaceManager.analyzeWorkspace();
            console.log(chalk.cyan('Auto-detected workspace configuration'));
          }

          // Save configuration
          const currentConfig = await configService.loadProjectConfig() || {};
          currentConfig.workspaceSetup = workspaceSetup;
          await configService.saveProjectConfig(currentConfig);

          console.log();
          console.log(chalk.green('Workspace configuration saved to forge.config.json'));
          
          // Show summary
          console.log();
          console.log(chalk.blue('Configuration Summary:'));
          console.log(`  Package Manager: ${workspaceSetup.packageManager}`);
          console.log(`  Pre-deploy Steps: ${workspaceSetup.preDeploySteps?.length || 0}`);
          console.log(`  Build Steps: ${workspaceSetup.buildSteps?.length || 0}`);
          console.log(`  Post-deploy Steps: ${workspaceSetup.postDeploySteps?.length || 0}`);

          if (workspaceSetup.monorepo) {
            console.log(`  Monorepo Type: ${workspaceSetup.monorepo.type}`);
          }

          console.log();
          console.log(chalk.gray('Use "forge deploy --use-workspace-config" to deploy with this configuration'));

        } catch (error) {
          console.log(chalk.red('Failed to initialize workspace configuration'));
          console.error(error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('list-templates')
      .description('List available workspace templates')
      .action(() => {
        const templates = WorkspaceManager.getWorkspaceTemplates();
        
        console.log(chalk.blue('Available Workspace Templates:'));
        console.log();

        Object.keys(templates).forEach(name => {
          const template = templates[name];
          console.log(chalk.cyan(`${name}:`));
          
          if (template.preDeploySteps?.length) {
            console.log(`  Pre-deploy: ${template.preDeploySteps.length} steps`);
          }
          if (template.buildSteps?.length) {
            console.log(`  Build: ${template.buildSteps.length} steps`);
          }
          if (template.postDeploySteps?.length) {
            console.log(`  Post-deploy: ${template.postDeploySteps.length} steps`);
          }
          console.log();
        });

        console.log(chalk.gray('Use "forge workspace init --template <name>" to use a template'));
      })
  )
  .addCommand(
    new Command('validate')
      .description('Validate current workspace configuration')
      .action(async () => {
        try {
          const configService = new ConfigService();
          const config = await configService.loadProjectConfig();

          if (!config?.workspaceSetup) {
            console.log(chalk.yellow('No workspace configuration found'));
            console.log(chalk.gray('Run "forge workspace init" to create one'));
            return;
          }

          const workspaceSetup = config.workspaceSetup;
          
          console.log(chalk.blue('Workspace Configuration Validation'));
          console.log();

          // Validate package manager
          const packageManager = workspaceSetup.packageManager;
          console.log(`Package Manager: ${chalk.green(packageManager)}`);

          // Validate steps
          const totalSteps = (workspaceSetup.preDeploySteps?.length || 0) +
                           (workspaceSetup.buildSteps?.length || 0) +
                           (workspaceSetup.postDeploySteps?.length || 0);

          console.log(`Total Steps: ${chalk.green(totalSteps)}`);

          if (workspaceSetup.preDeploySteps?.length) {
            console.log(`Pre-deploy Steps: ${chalk.cyan(workspaceSetup.preDeploySteps.length)}`);
          }
          if (workspaceSetup.buildSteps?.length) {
            console.log(`Build Steps: ${chalk.cyan(workspaceSetup.buildSteps.length)}`);
          }
          if (workspaceSetup.postDeploySteps?.length) {
            console.log(`Post-deploy Steps: ${chalk.cyan(workspaceSetup.postDeploySteps.length)}`);
          }

          console.log();
          console.log(chalk.green('Configuration is valid'));

        } catch (error) {
          console.log(chalk.red('Failed to validate workspace configuration'));
          console.error(error);
          process.exit(1);
        }
      })
  );
