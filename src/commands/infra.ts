import chalk from 'chalk';
import { Command } from 'commander';
import { LocalDeploymentManager } from '../services/localDeployment';
import { AutoRestartService } from '../services/autoRestart';
import { checkSystemPrivileges, requireElevatedPrivileges, isWindows } from '../utils/system';
import os from 'os';

export const infraCommand = new Command('infra')
  .description('Setup infrastructure for local deployments')
  .option('--nginx', 'Setup nginx reverse proxy')
  .option('--pm2', 'Setup PM2 process manager')
  .option('--nodejs', 'Setup Node.js dependencies (serve, etc.)')
  .option('--python', 'Setup Python dependencies (uvicorn, gunicorn, etc.)')
  .option('--ssl', 'Setup SSL certificates with Certbot')
  .option('--service', 'Setup auto-restart service')
  .option('--all', 'Setup all infrastructure components')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('🔧 Forge Infrastructure Setup'));
      console.log(chalk.gray('Setting up local deployment infrastructure...'));
      console.log();

      // Check system privileges
      const hasElevatedPrivileges = checkSystemPrivileges();
      
      const setupAll = options.all;
      let hasErrors = false;

      // Setup Node.js and basic dependencies
      if (setupAll || options.nodejs) {
        console.log(chalk.cyan('📦 Setting up Node.js dependencies...'));
        try {
          await setupNodeJSDependencies();
          console.log(chalk.green('✅ Node.js dependencies setup completed'));
        } catch (error) {
          console.log(chalk.red(`❌ Node.js dependencies setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

      // Setup Python dependencies
      if (setupAll || options.python) {
        console.log(chalk.cyan('🐍 Setting up Python dependencies...'));
        try {
          await setupPythonDependencies();
          console.log(chalk.green('✅ Python setup completed'));
        } catch (error) {
          console.log(chalk.red(`❌ Python setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

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

      // Setup nginx (requires elevated privileges)
      if (setupAll || options.nginx) {
        console.log(chalk.cyan('🌐 Setting up Nginx Reverse Proxy...'));
        try {
          if (!hasElevatedPrivileges) {
            console.log(chalk.yellow('⚠️  Nginx setup requires elevated privileges'));
            if (isWindows()) {
              console.log(chalk.gray('  Run PowerShell as Administrator and retry'));
            } else {
              console.log(chalk.gray('  Run with sudo: sudo forge infra --nginx'));
            }
            hasErrors = true;
          } else {
            await setupNginxPackage();
            await LocalDeploymentManager.setupNginx();
            console.log(chalk.green('✅ Nginx setup completed'));
            
            // Show nginx configuration instructions
            console.log(chalk.blue('📋 Nginx Configuration:'));
            if (isWindows()) {
              console.log(chalk.gray('  • Nginx config directory: C:\\nginx\\conf\\forge-sites'));
              console.log(chalk.gray('  • Start nginx: C:\\nginx\\nginx.exe'));
              console.log(chalk.gray('  • Reload config: nginx -s reload'));
            } else {
              console.log(chalk.gray('  • Nginx config directory: /etc/nginx/sites-available'));
              console.log(chalk.gray('  • Enable site: sudo ln -s /etc/nginx/sites-available/site.conf /etc/nginx/sites-enabled/'));
              console.log(chalk.gray('  • Reload config: sudo nginx -s reload'));
              console.log(chalk.gray('  • Check status: sudo systemctl status nginx'));
            }
          }
        } catch (error) {
          console.log(chalk.red(`❌ Nginx setup failed: ${error}`));
          hasErrors = true;
        }
        console.log();
      }

      // Setup Python dependencies (for Python projects)
      if (setupAll || options.python) {
        console.log(chalk.cyan('🐍 Setting up Python dependencies...'));
        try {
          await setupPythonDependencies();
          console.log(chalk.green('✅ Python dependencies setup completed'));
        } catch (error) {
          console.log(chalk.red(`❌ Python dependencies setup failed: ${error}`));
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

      // Setup SSL certificates with Certbot
      if (setupAll || options.ssl) {
        console.log(chalk.cyan('🔒 Setting up SSL certificates with Certbot...'));
        try {
          if (!hasElevatedPrivileges) {
            console.log(chalk.yellow('⚠️  SSL setup requires elevated privileges'));
            if (isWindows()) {
              console.log(chalk.gray('  Run PowerShell as Administrator and retry'));
            } else {
              console.log(chalk.gray('  Run with sudo: sudo forge infra --ssl'));
            }
            hasErrors = true;
          } else {
            await setupSSLCertificates();
            console.log(chalk.green('✅ SSL certificates setup completed'));
          }
        } catch (error) {
          console.log(chalk.red(`❌ SSL setup failed: ${error}`));
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
        console.log(chalk.gray('  2. Subdomains are automatically managed via API'));
        console.log(chalk.gray('  3. SSL certificates are automatically provisioned'));
        console.log(chalk.gray('  4. Configure firewall to allow HTTP/HTTPS traffic (ports 80, 443)'));
        console.log();
        console.log(chalk.blue('🔧 Management Commands:'));
        console.log(chalk.gray('  • forge status - Check all deployments'));
        console.log(chalk.gray('  • forge pause <deployment-id> - Pause a deployment'));
        console.log(chalk.gray('  • forge resume <deployment-id> - Resume a deployment'));
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

async function setupNodeJSDependencies(): Promise<void> {
  const { execSync } = await import('child_process');
  
  console.log(chalk.gray('Installing global Node.js dependencies...'));
  
  const packages = ['serve', 'http-server', 'live-server'];
  
  for (const pkg of packages) {
    try {
      console.log(chalk.gray(`Installing ${pkg}...`));
      execSync(`npm install -g ${pkg}`, { stdio: 'inherit' });
    } catch (error) {
      console.log(chalk.yellow(`Warning: Could not install ${pkg}`));
    }
  }
}

async function setupPythonDependencies(): Promise<void> {
  const { execSync } = await import('child_process');
  
  let pythonCmd = 'python';
  let pipCmd = 'pip';
  
  // Check if Python is installed
  try {
    execSync('python --version', { stdio: 'pipe' });
  } catch {
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      pythonCmd = 'python3';
      pipCmd = 'pip3';
    } catch {
      console.log(chalk.yellow('Python not found. Installing Python...'));
      
      if (isWindows()) {
        console.log(chalk.gray('Please install Python from https://python.org/downloads/'));
        console.log(chalk.gray('Or use winget: winget install Python.Python.3'));
        return;
      } else {
        try {
          // Try to install Python on Linux
          try {
            execSync('sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv python3-full', { stdio: 'inherit' });
          } catch {
            try {
              execSync('sudo yum install -y python3 python3-pip', { stdio: 'inherit' });
            } catch {
              try {
                execSync('sudo dnf install -y python3 python3-pip', { stdio: 'inherit' });
              } catch {
                console.log(chalk.red('Could not install Python automatically'));
                console.log(chalk.gray('Please install Python manually and retry'));
                return;
              }
            }
          }
          pythonCmd = 'python3';
          pipCmd = 'pip3';
          console.log(chalk.green('Python installed successfully'));
        } catch (error) {
          console.log(chalk.red(`Failed to install Python: ${error}`));
          return;
        }
      }
    }
  }
  
  // Check if pip is available
  try {
    execSync(`${pipCmd} --version`, { stdio: 'pipe' });
  } catch {
    console.log(chalk.yellow('pip not found. Installing pip...'));
    if (isWindows()) {
      try {
        execSync(`${pythonCmd} -m ensurepip --upgrade`, { stdio: 'inherit' });
      } catch {
        console.log(chalk.red('Could not install pip. Please install manually.'));
        return;
      }
    } else {
      try {
        execSync('sudo apt-get install -y python3-pip python3-venv', { stdio: 'inherit' });
      } catch {
        try {
          execSync(`${pythonCmd} -m ensurepip --upgrade`, { stdio: 'inherit' });
        } catch {
          console.log(chalk.red('Could not install pip. Please install manually.'));
          return;
        }
      }
    }
  }
  
  console.log(chalk.gray('Setting up Python web server dependencies...'));
  
  // For newer Python distributions, try system packages first, then pipx, then venv
  const packages = ['uvicorn', 'gunicorn', 'waitress'];
  const systemPackages = ['python3-uvicorn', 'python3-gunicorn', 'python3-waitress'];
  
  if (!isWindows()) {
    // Try installing system packages first (preferred for newer distributions)
    console.log(chalk.gray('Attempting to install system Python packages...'));
    for (let i = 0; i < systemPackages.length; i++) {
      try {
        console.log(chalk.gray(`Installing ${systemPackages[i]}...`));
        execSync(`sudo apt-get install -y ${systemPackages[i]}`, { stdio: 'pipe' });
      } catch {
        // If system package fails, skip for now
        console.log(chalk.yellow(`System package ${systemPackages[i]} not available`));
      }
    }
    
    // Try pipx for user-installed packages
    try {
      execSync('pipx --version', { stdio: 'pipe' });
      console.log(chalk.gray('Using pipx for Python package installation...'));
      
      for (const pkg of packages) {
        try {
          console.log(chalk.gray(`Installing ${pkg} with pipx...`));
          execSync(`pipx install ${pkg}`, { stdio: 'inherit' });
        } catch (error) {
          console.log(chalk.yellow(`Warning: Could not install ${pkg} with pipx`));
        }
      }
    } catch {
      // pipx not available, try installing it
      try {
        console.log(chalk.gray('Installing pipx...'));
        execSync('sudo apt-get install -y pipx', { stdio: 'inherit' });
        
        for (const pkg of packages) {
          try {
            console.log(chalk.gray(`Installing ${pkg} with pipx...`));
            execSync(`pipx install ${pkg}`, { stdio: 'inherit' });
          } catch (error) {
            console.log(chalk.yellow(`Warning: Could not install ${pkg} with pipx`));
          }
        }
      } catch {
        // If pipx installation fails, create a system-wide virtual environment
        console.log(chalk.gray('Creating system virtual environment for Python packages...'));
        try {
          const venvPath = '/opt/forge-python-env';
          execSync(`sudo ${pythonCmd} -m venv ${venvPath}`, { stdio: 'inherit' });
          
          for (const pkg of packages) {
            try {
              console.log(chalk.gray(`Installing ${pkg} in virtual environment...`));
              execSync(`sudo ${venvPath}/bin/pip install ${pkg}`, { stdio: 'inherit' });
            } catch (error) {
              console.log(chalk.yellow(`Warning: Could not install ${pkg} in venv`));
            }
          }
          
          // Create symlinks for easy access
          try {
            execSync(`sudo ln -sf ${venvPath}/bin/uvicorn /usr/local/bin/uvicorn`, { stdio: 'pipe' });
            execSync(`sudo ln -sf ${venvPath}/bin/gunicorn /usr/local/bin/gunicorn`, { stdio: 'pipe' });
            console.log(chalk.green('Python web server tools installed in system virtual environment'));
          } catch {
            console.log(chalk.yellow('Warning: Could not create symlinks for Python tools'));
          }
        } catch (venvError) {
          console.log(chalk.yellow(`Warning: Could not create virtual environment: ${venvError}`));
          console.log(chalk.gray('Python web frameworks may need to be installed manually'));
        }
      }
    }
  } else {
    // Windows - use regular pip
    for (const pkg of packages) {
      try {
        console.log(chalk.gray(`Installing ${pkg}...`));
        execSync(`${pipCmd} install ${pkg}`, { stdio: 'inherit' });
      } catch (error) {
        console.log(chalk.yellow(`Warning: Could not install ${pkg}`));
      }
    }
  }
  
  console.log(chalk.green('Python setup completed'));
  console.log(chalk.blue('📋 Python Tools Available:'));
  
  // Check what's actually available
  const tools = [
    { name: 'uvicorn', desc: 'ASGI server for FastAPI/Starlette' },
    { name: 'gunicorn', desc: 'WSGI server for Flask/Django' },
    { name: 'waitress', desc: 'Pure Python WSGI server' }
  ];
  
  for (const tool of tools) {
    try {
      execSync(`which ${tool.name} || where ${tool.name}`, { stdio: 'pipe' });
      console.log(chalk.green(`  ✓ ${tool.name} - ${tool.desc}`));
    } catch {
      console.log(chalk.gray(`  ✗ ${tool.name} - ${tool.desc} (not available)`));
    }
  }
}

async function setupNginxPackage(): Promise<void> {
  const { execSync } = await import('child_process');
  
  try {
    // Check if nginx is already installed
    execSync('nginx -v', { stdio: 'pipe' });
    console.log(chalk.gray('Nginx is already installed'));
    return;
  } catch {
    // Nginx not installed, proceed with installation
  }
  
  console.log(chalk.gray('Installing nginx...'));
  
  if (isWindows()) {
    console.log(chalk.yellow('Windows nginx installation:'));
    console.log(chalk.gray('  1. Download nginx from http://nginx.org/en/download.html'));
    console.log(chalk.gray('  2. Extract to C:\\nginx'));
    console.log(chalk.gray('  3. Add C:\\nginx to your PATH'));
    console.log(chalk.gray('  4. Run "nginx.exe" to start'));
    console.log(chalk.gray('Or use chocolatey: choco install nginx'));
    return;
  }
  
  // Linux installation
  try {
    // Try different package managers
    try {
      console.log(chalk.gray('Updating package repositories...'));
      execSync('apt-get update', { stdio: 'inherit' });
      console.log(chalk.gray('Installing nginx via apt...'));
      execSync('apt-get install -y nginx', { stdio: 'inherit' });
    } catch {
      try {
        console.log(chalk.gray('Installing nginx via yum...'));
        execSync('yum install -y nginx', { stdio: 'inherit' });
      } catch {
        try {
          console.log(chalk.gray('Installing nginx via dnf...'));
          execSync('dnf install -y nginx', { stdio: 'inherit' });
        } catch {
          throw new Error('Could not install nginx automatically. Please install manually.');
        }
      }
    }
    
    // Enable and start nginx
    try {
      console.log(chalk.gray('Enabling nginx service...'));
      execSync('systemctl enable nginx', { stdio: 'pipe' });
      console.log(chalk.gray('Starting nginx service...'));
      execSync('systemctl start nginx', { stdio: 'pipe' });
      console.log(chalk.green('Nginx installed and started successfully'));
    } catch (error) {
      console.log(chalk.yellow('Warning: Could not enable/start nginx service automatically'));
      console.log(chalk.gray('You may need to start it manually: sudo systemctl start nginx'));
    }
    
    // Test nginx installation
    try {
      execSync('nginx -v', { stdio: 'pipe' });
      console.log(chalk.green('Nginx installation verified'));
    } catch {
      throw new Error('Nginx installation failed verification');
    }
    
  } catch (error) {
    console.log(chalk.red(`Failed to install nginx: ${error}`));
    throw error;
  }
}

async function setupSSLCertificates(): Promise<void> {
  const { execSync } = await import('child_process');
  
  if (isWindows()) {
    console.log(chalk.yellow('SSL certificate setup on Windows:'));
    console.log(chalk.gray('  For Windows, SSL certificates are typically handled by:'));
    console.log(chalk.gray('  1. Use a reverse proxy like Cloudflare'));
    console.log(chalk.gray('  2. Use IIS with SSL bindings'));
    console.log(chalk.gray('  3. Use Win-ACME for Let\'s Encrypt certificates'));
    console.log(chalk.gray('  Download Win-ACME: https://www.win-acme.com/'));
    return;
  }
  
  console.log(chalk.gray('Installing Certbot for automatic SSL certificates...'));
  
  try {
    // Check if certbot is already installed
    try {
      execSync('certbot --version', { stdio: 'pipe' });
      console.log(chalk.gray('Certbot is already installed'));
    } catch {
      // Install certbot based on the OS
      try {
        console.log(chalk.gray('Installing certbot via apt...'));
        execSync('apt-get update', { stdio: 'inherit' });
        execSync('apt-get install -y certbot python3-certbot-nginx', { stdio: 'inherit' });
      } catch {
        try {
          console.log(chalk.gray('Installing certbot via snap...'));
          execSync('snap install core; snap refresh core', { stdio: 'inherit' });
          execSync('snap install --classic certbot', { stdio: 'inherit' });
          execSync('ln -sf /snap/bin/certbot /usr/bin/certbot', { stdio: 'inherit' });
        } catch {
          try {
            console.log(chalk.gray('Installing certbot via yum/dnf...'));
            execSync('yum install -y certbot python3-certbot-nginx || dnf install -y certbot python3-certbot-nginx', { stdio: 'inherit' });
          } catch {
            throw new Error('Could not install certbot automatically');
          }
        }
      }
    }
    
    // Create certbot renewal systemd timer
    console.log(chalk.gray('Setting up automatic certificate renewal...'));
    try {
      execSync('systemctl enable certbot.timer', { stdio: 'pipe' });
      execSync('systemctl start certbot.timer', { stdio: 'pipe' });
      console.log(chalk.green('Automatic certificate renewal enabled'));
    } catch {
      console.log(chalk.yellow('Warning: Could not enable automatic renewal'));
    }
    
    // Create certificate setup script for deployments
    const fs = await import('fs-extra');
    const certbotScript = `#!/bin/bash
# Forge SSL Certificate Setup Script
# This script is called automatically when deploying with SSL

DOMAIN=$1
PUBLIC_IP=$2

if [ -z "$DOMAIN" ] || [ -z "$PUBLIC_IP" ]; then
    echo "Usage: $0 <domain> <public-ip>"
    exit 1
fi

echo "Setting up SSL certificate for $DOMAIN..."

# Check if certificate already exists
if certbot certificates | grep -q "$DOMAIN"; then
    echo "Certificate for $DOMAIN already exists"
    exit 0
fi

# Request certificate using nginx plugin
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Reload nginx to apply changes
nginx -s reload

echo "SSL certificate setup completed for $DOMAIN"
`;
    
    const scriptPath = '/usr/local/bin/forge-ssl-setup';
    await fs.writeFile(scriptPath, certbotScript);
    execSync(`chmod +x ${scriptPath}`, { stdio: 'pipe' });
    console.log(chalk.gray(`Created SSL setup script: ${scriptPath}`));
    
    console.log(chalk.green('Certbot setup completed successfully'));
    console.log(chalk.blue('📋 SSL Certificate Info:'));
    console.log(chalk.gray('  • Certificates will be automatically requested for new deployments'));
    console.log(chalk.gray('  • Automatic renewal is enabled via systemd timer'));
    console.log(chalk.gray('  • Certificates are stored in /etc/letsencrypt/live/'));
    console.log(chalk.gray('  • Manual certificate request: certbot --nginx -d yourdomain.com'));
    
  } catch (error) {
    console.log(chalk.red(`Failed to setup SSL certificates: ${error}`));
    throw error;
  }
}
