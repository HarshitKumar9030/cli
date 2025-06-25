import chalk from 'chalk';
import { Command } from 'commander';
import { LocalDeploymentManager } from '../services/localDeployment';
import { AutoRestartService } from '../services/autoRestart';
import os from 'os';

export const infraCommand = new Command('infra')
  .description('Setup infrastructure for local deployments')
  .option('--nginx', 'Setup nginx reverse proxy')
  .option('--pm2', 'Setup PM2 process manager')
  .option('--service', 'Setup auto-restart service')
  .option('--all', 'Setup all infrastructure components')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('🔧 Forge Infrastructure Setup'));
      console.log(chalk.gray('Setting up local deployment infrastructure...'));
      console.log();

      const setupAll = options.all;
      let hasErrors = false;

      // Setup PM2
      if (setupAll || options.pm2) {
        console.log(chalk.cyan('📦 Setting up PM2 Process Manager...'));
        try {
          await setupPM2();
          console.log(chalk.green('✅ PM2 setup completed'));
        } catch (error) {
          console.log(chalk.red(`❌ PM2 setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

      // Setup nginx
      if (setupAll || options.nginx) {
        console.log(chalk.cyan('🌐 Setting up Nginx Reverse Proxy...'));
        try {
          await LocalDeploymentManager.setupNginx();
          console.log(chalk.green('✅ Nginx setup completed'));
          
          // Show nginx configuration instructions
          console.log(chalk.blue('📋 Nginx Configuration:'));
          if (os.platform() === 'win32') {
            console.log(chalk.gray('  • Nginx config directory: C:\\nginx\\conf\\forge-sites'));
            console.log(chalk.gray('  • Start nginx: C:\\nginx\\nginx.exe'));
            console.log(chalk.gray('  • Reload config: nginx -s reload'));
          } else {
            console.log(chalk.gray('  • Nginx config directory: /etc/nginx/sites-available'));
            console.log(chalk.gray('  • Enable site: sudo ln -s /etc/nginx/sites-available/site.conf /etc/nginx/sites-enabled/'));
            console.log(chalk.gray('  • Reload config: sudo nginx -s reload'));
          }
        } catch (error) {
          console.log(chalk.red(`❌ Nginx setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

      // Setup auto-restart service
      if (setupAll || options.service) {
        console.log(chalk.cyan('🔄 Setting up Auto-Restart Service...'));
        try {
          await AutoRestartService.setupAutoRestart();
          console.log(chalk.green('✅ Auto-restart service setup completed'));
        } catch (error) {
          console.log(chalk.red(`❌ Auto-restart service setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

      // Final instructions
      if (!hasErrors) {
        console.log(chalk.green.bold('🎉 Infrastructure setup completed successfully!'));
        console.log();
        console.log(chalk.blue('🚀 Next Steps:'));
        console.log(chalk.gray('  1. Deploy your applications: forge deploy <repo-url>'));
        console.log(chalk.gray('  2. Configure DNS to point subdomains to your server IP'));
        console.log(chalk.gray('  3. Setup SSL certificates (optional but recommended)'));
        console.log(chalk.gray('  4. Configure firewall to allow HTTP/HTTPS traffic'));
        console.log();
        console.log(chalk.blue('🔧 Management Commands:'));
        console.log(chalk.gray('  • forge status - Check all deployments'));
        console.log(chalk.gray('  • forge stop <deployment-id> - Stop a deployment'));
        console.log(chalk.gray('  • forge logs <deployment-id> - View deployment logs'));
      } else {
        console.log(chalk.yellow('⚠️  Infrastructure setup completed with some errors'));
        console.log(chalk.gray('Check the error messages above and resolve them manually'));
      }

    } catch (error) {
      console.log(chalk.red(`Infrastructure setup failed: ${error}`));
      process.exit(1);
    }
  });

async function setupPM2(): Promise<void> {
  const { execSync } = await import('child_process');
  
  try {
    // Check if PM2 is installed
    execSync('pm2 --version', { stdio: 'pipe' });
    console.log(chalk.gray('PM2 is already installed'));
  } catch {
    console.log(chalk.gray('Installing PM2...'));
    execSync('npm install -g pm2', { stdio: 'inherit' });
  }

  // Setup PM2 startup
  try {
    if (os.platform() === 'win32') {
      console.log(chalk.gray('Setting up PM2 Windows service...'));
      try {
        execSync('pm2-windows-startup install', { stdio: 'inherit' });
      } catch {
        console.log(chalk.yellow('Warning: pm2-windows-startup not found, installing...'));
        execSync('npm install -g pm2-windows-startup', { stdio: 'inherit' });
        execSync('pm2-windows-startup install', { stdio: 'inherit' });
      }
    } else {
      console.log(chalk.gray('Setting up PM2 startup script...'));
      const startupCommand = execSync('pm2 startup', { encoding: 'utf8' });
      console.log(chalk.yellow('Please run the following command as root:'));
      console.log(chalk.cyan(startupCommand.trim()));
    }
  } catch (error) {
    console.log(chalk.yellow('Warning: Could not setup PM2 auto-startup'));
    console.log(chalk.gray('You may need to configure this manually'));
  }

  // Create PM2 ecosystem configuration
  console.log(chalk.gray('Creating PM2 ecosystem configuration...'));
  const ecosystemConfig = `module.exports = {
  apps: [
    // Forge deployments will be added here automatically
  ],
  deploy: {
    production: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:repo.git',
      path: '/var/www/production',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
};`;

  const fs = await import('fs-extra');
  const path = await import('path');
  
  const ecosystemPath = path.join(process.cwd(), 'ecosystem.config.js');
  if (!await fs.pathExists(ecosystemPath)) {
    await fs.writeFile(ecosystemPath, ecosystemConfig);
    console.log(chalk.gray(`Created PM2 ecosystem file: ${ecosystemPath}`));
  }
}
