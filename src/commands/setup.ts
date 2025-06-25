import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { DependencyInstaller } from '../installers/dependencies';
import { AutoRestartService } from '../services/autoRestart';
import { getSystemInfo, isElevated } from '../utils/system';
import { DevPlatform, Framework } from '../types';

export const setupCommand = new Command('setup')
  .description('Set up system dependencies and environment')
  .option('--platform <platform>', 'Target platform (nodejs, python, php, static)')
  .option('--framework <framework>', 'Target framework')
  .option('--skip-install', 'Skip dependency installation')
  .option('--auto-restart', 'Setup auto-restart service')
  .option('--remove-auto-restart', 'Remove auto-restart service')
  .option('--status', 'Show current setup status')
  .option('--list-platforms', 'List supported platforms')
  .option('--list-frameworks', 'List supported frameworks')
  .action(async (options) => {
    try {
      if (options.listPlatforms) {
        listPlatforms();
        return;
      }

      if (options.listFrameworks) {
        listFrameworks();
        return;
      }

      if (options.status) {
        await showSetupStatus();
        return;
      }

      if (options.removeAutoRestart) {
        await removeAutoRestart();
        return;
      }

      if (options.autoRestart) {
        await setupAutoRestart();
        return;
      }

      console.log(chalk.blue('Forge CLI Setup'));
      console.log(chalk.gray('Setting up your development environment...'));
      console.log();

      let platform: DevPlatform;
      let framework: Framework | undefined;

      if (options.platform) {
        platform = options.platform as DevPlatform;
        if (!Object.values(DevPlatform).includes(platform)) {
          console.log(chalk.red(`Error: Unsupported platform "${options.platform}"`));
          console.log('Run "forge setup --list-platforms" to see supported platforms');
          process.exit(1);
        }
      } else {
        const { selectedPlatform } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedPlatform',
            message: 'Select your primary development platform:',
            choices: [
              { name: 'Node.js (JavaScript/TypeScript)', value: DevPlatform.NODEJS },
              { name: 'Python', value: DevPlatform.PYTHON },
              { name: 'PHP', value: DevPlatform.PHP },
              { name: 'Static Sites (HTML/CSS/JS)', value: DevPlatform.STATIC }
            ]
          }
        ]);
        platform = selectedPlatform;
      }

      if (options.framework) {
        framework = options.framework as Framework;
        if (!Object.values(Framework).includes(framework)) {
          console.log(chalk.red(`Error: Unsupported framework "${options.framework}"`));
          console.log('Run "forge setup --list-frameworks" to see supported frameworks');
          process.exit(1);
        }
      } else if (platform === DevPlatform.NODEJS) {
        const { selectedFramework } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedFramework',
            message: 'Select a Node.js framework (optional):',
            choices: [
              { name: 'Next.js', value: Framework.NEXTJS },
              { name: 'Nuxt.js', value: Framework.NUXT },
              { name: 'Vue.js', value: Framework.VUE },
              { name: 'React', value: Framework.REACT },
              { name: 'Express.js', value: Framework.EXPRESS },
              { name: 'None/Vanilla Node.js', value: null }
            ]
          }
        ]);
        framework = selectedFramework;
      }

      if (!options.skipInstall) {
        console.log(chalk.blue('Installing dependencies...'));
        console.log(chalk.gray('This may take a few minutes...'));
        console.log();

        const installer = new DependencyInstaller();
        
        if (framework) {
          console.log(chalk.cyan(`Installing ${framework} dependencies for ${platform}...`));
          await installer.installSystemDependencies(framework);
        } else {
          // Install base dependencies for the platform
          console.log(chalk.cyan(`Installing base dependencies for ${platform}...`));
          const defaultFramework = getDefaultFramework(platform);
          if (defaultFramework) {
            await installer.installSystemDependencies(defaultFramework);
          }
        }

        console.log();
        console.log(chalk.green('Dependencies installed successfully!'));
      } else {
        console.log(chalk.yellow('Skipping dependency installation'));
      }

      // Simple verification by checking if common tools exist
      console.log(chalk.blue('Verifying installation...'));
      const verification = await verifyBasicInstallation(platform, framework);
      
      console.log();
      console.log(chalk.blue('Installation Summary:'));
      verification.forEach((item: { name: string; installed: boolean; version?: string }) => {
        const status = item.installed ? chalk.green('✓') : chalk.red('✗');
        console.log(`  ${status} ${item.name}: ${item.version || 'Not found'}`);
      });

      const allInstalled = verification.every((item: { installed: boolean }) => item.installed);
      
      console.log();
      if (allInstalled) {
        console.log(chalk.green('Setup completed successfully!'));
        console.log(chalk.gray('You can now run "forge init" to start a new project'));
      } else {
        console.log(chalk.yellow('Setup completed with some issues'));
        console.log(chalk.gray('Some dependencies may need manual installation'));
      }

    } catch (error) {
      console.log(chalk.red(`Error: ${error}`));
      process.exit(1);
    }
  });

function listPlatforms(): void {
  console.log(chalk.blue('Supported Platforms:'));
  console.log();
  console.log(chalk.cyan('nodejs') + chalk.gray('   - Node.js applications (JavaScript/TypeScript)'));
  console.log(chalk.cyan('python') + chalk.gray('   - Python applications (Django, Flask, FastAPI)'));
  console.log(chalk.cyan('php') + chalk.gray('      - PHP applications (Laravel, Symfony, WordPress)'));
  console.log(chalk.cyan('static') + chalk.gray('   - Static websites (HTML/CSS/JS)'));
  console.log();
  console.log(chalk.gray('Use: forge setup --platform <platform>'));
}

function listFrameworks(): void {
  console.log(chalk.blue('Supported Frameworks:'));
  console.log();
  console.log(chalk.yellow('Node.js:'));
  console.log(chalk.cyan('  nextjs') + chalk.gray('    - Next.js React framework'));
  console.log(chalk.cyan('  nuxtjs') + chalk.gray('    - Nuxt.js Vue framework'));
  console.log(chalk.cyan('  vue') + chalk.gray('       - Vue.js frontend framework'));
  console.log(chalk.cyan('  react') + chalk.gray('     - React frontend library'));
  console.log(chalk.cyan('  express') + chalk.gray('   - Express.js backend framework'));
  console.log(chalk.cyan('  angular') + chalk.gray('   - Angular frontend framework'));
  console.log(chalk.cyan('  svelte') + chalk.gray('    - Svelte frontend framework'));
  console.log();
  console.log(chalk.yellow('Python:'));
  console.log(chalk.cyan('  django') + chalk.gray('    - Django web framework'));
  console.log(chalk.cyan('  flask') + chalk.gray('     - Flask micro framework'));
  console.log(chalk.cyan('  fastapi') + chalk.gray('   - FastAPI modern framework'));
  console.log();
  console.log(chalk.yellow('PHP:'));
  console.log(chalk.cyan('  laravel') + chalk.gray('   - Laravel web framework'));
  console.log(chalk.cyan('  symfony') + chalk.gray('   - Symfony web framework'));
  console.log(chalk.cyan('  wordpress') + chalk.gray(' - WordPress CMS'));
  console.log();
  console.log(chalk.gray('Use: forge setup --framework <framework>'));
}

function getDefaultFramework(platform: DevPlatform): Framework | null {
  switch (platform) {
    case DevPlatform.NODEJS:
      return Framework.EXPRESS; // Default to Express for Node.js
    case DevPlatform.PYTHON:
      return Framework.FLASK; // Default to Flask for Python
    case DevPlatform.PHP:
      return Framework.LARAVEL; // Default to Laravel for PHP
    case DevPlatform.STATIC:
      return Framework.STATIC;
    default:
      return null;
  }
}

async function verifyBasicInstallation(platform: DevPlatform, framework?: Framework): Promise<Array<{ name: string; installed: boolean; version?: string }>> {
  const results: Array<{ name: string; installed: boolean; version?: string }> = [];
  
  // Check Node.js
  try {
    const { execSync } = await import('child_process');
    const version = execSync('node --version', { encoding: 'utf8' }).trim();
    results.push({ name: 'Node.js', installed: true, version });
  } catch {
    results.push({ name: 'Node.js', installed: false });
  }

  // Check pnpm
  try {
    const { execSync } = await import('child_process');
    const version = execSync('pnpm --version', { encoding: 'utf8' }).trim();
    results.push({ name: 'pnpm', installed: true, version });
  } catch {
    results.push({ name: 'pnpm', installed: false });
  }

  // Check Git
  try {
    const { execSync } = await import('child_process');
    const version = execSync('git --version', { encoding: 'utf8' }).trim();
    results.push({ name: 'Git', installed: true, version });
  } catch {
    results.push({ name: 'Git', installed: false });
  }

  // Check Docker
  try {
    const { execSync } = await import('child_process');
    const version = execSync('docker --version', { encoding: 'utf8' }).trim();
    results.push({ name: 'Docker', installed: true, version });
  } catch {
    results.push({ name: 'Docker', installed: false });
  }

  // Platform-specific checks
  if (platform === DevPlatform.PYTHON) {
    try {
      const { execSync } = await import('child_process');
      const version = execSync('python3 --version', { encoding: 'utf8' }).trim();
      results.push({ name: 'Python3', installed: true, version });
    } catch {
      results.push({ name: 'Python3', installed: false });
    }
  }

  if (platform === DevPlatform.PHP) {
    try {
      const { execSync } = await import('child_process');
      const version = execSync('php --version', { encoding: 'utf8' }).split('\n')[0];
      results.push({ name: 'PHP', installed: true, version });
    } catch {
      results.push({ name: 'PHP', installed: false });
    }
  }

  return results;
}

async function setupAutoRestart(): Promise<void> {
  console.log(chalk.cyan('Setting up auto-restart service...'));
  
  if (!isElevated()) {
    console.log(chalk.yellow('Warning: Auto-restart setup may require administrator/root privileges'));
    console.log(chalk.gray('Some features may not be available without elevated permissions'));
  }

  try {
    await AutoRestartService.setupAutoRestart();
    console.log(chalk.green('Auto-restart service configured successfully'));
    
    const { startNow } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'startNow',
        message: 'Start the auto-restart service now?',
        default: true
      }
    ]);

    if (startNow) {
      await AutoRestartService.startAutoRestart();
    }
  } catch (error) {
    console.log(chalk.red(`Failed to setup auto-restart: ${error}`));
  }
}

async function removeAutoRestart(): Promise<void> {
  console.log(chalk.cyan('Removing auto-restart service...'));
  
  try {
    await AutoRestartService.removeAutoRestart();
    console.log(chalk.green('Auto-restart service removed successfully'));
  } catch (error) {
    console.log(chalk.red(`Failed to remove auto-restart: ${error}`));
  }
}

async function showSetupStatus(): Promise<void> {
  console.log(chalk.blue('Forge CLI Setup Status'));
  console.log();

  const systemInfo = getSystemInfo();
  console.log(chalk.blue('System Information:'));
  console.log(`  ${chalk.cyan('Platform:')} ${systemInfo.platform} (${systemInfo.arch})`);
  console.log(`  ${chalk.cyan('Hostname:')} ${systemInfo.hostname}`);
  console.log(`  ${chalk.cyan('Uptime:')} ${Math.floor(systemInfo.uptime / 3600)} hours`);
  console.log(`  ${chalk.cyan('Local IP:')} ${systemInfo.localIP}`);
  console.log(`  ${chalk.cyan('Elevated:')} ${systemInfo.isElevated ? 'Yes' : 'No'}`);
  console.log();

  // Check auto-restart status
  const autoRestartEnabled = await AutoRestartService.isAutoRestartEnabled();
  console.log(chalk.blue('Services:'));
  console.log(`  ${chalk.cyan('Auto-restart:')} ${autoRestartEnabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
  
  if (autoRestartEnabled) {
    console.log(chalk.gray('    The CLI will automatically restart after system reboots'));
  } else {
    console.log(chalk.gray('    Run "forge setup --auto-restart" to enable'));
  }
  
  console.log();
  
  // Check basic installations
  try {
    const installations = await verifyBasicInstallation(DevPlatform.NODEJS);
    console.log(chalk.blue('Dependencies:'));
    installations.forEach(dep => {
      const status = dep.installed ? chalk.green('✓') : chalk.red('✗');
      const version = dep.version ? chalk.gray(`(${dep.version})`) : '';
      console.log(`  ${status} ${dep.name} ${version}`);
    });
    console.log();
  } catch (error) {
    console.log(chalk.yellow('Could not verify dependencies'));
  }
  
  // Recommendations
  console.log(chalk.blue('Recommendations:'));
  
  if (!autoRestartEnabled) {
    console.log(chalk.yellow('  • Enable auto-restart for better uptime'));
  }
  
  if (!systemInfo.isElevated) {
    console.log(chalk.yellow('  • Run with elevated privileges for full functionality'));
  }
  
  console.log(chalk.gray('  • Use "forge deploy" to start deploying your applications'));
}
