import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { Framework, Platform } from '../types';

export class DependencyInstaller {
  private platform: NodeJS.Platform;

  constructor() {
    this.platform = process.platform;
  }

  async installSystemDependencies(framework: Framework, targetPlatform?: Platform): Promise<void> {
    console.log(chalk.blue('Installing system dependencies...'));

    // Install base dependencies
    await this.installBaseDependencies();

    // Install platform-specific dependencies
    if (targetPlatform) {
      await this.installPlatformDependencies(targetPlatform);
    } else {
      // Auto-detect best platform for framework
      const platform = this.detectBestPlatform(framework);
      await this.installPlatformDependencies(platform);
    }

    // Install framework-specific dependencies
    await this.installFrameworkDependencies(framework);

    console.log(chalk.green('System dependencies installed successfully!'));
  }

  private async installBaseDependencies(): Promise<void> {
    console.log(chalk.gray('Installing base dependencies...'));

    try {
      // Install Node.js if not present
      await this.ensureNodeJs();

      // Install pnpm if not present
      await this.ensurePnpm();

      // Install Git if not present
      await this.ensureGit();

      // Install Docker if not present
      await this.ensureDocker();

      // Install common build tools
      await this.installBuildTools();

    } catch (error) {
      console.error(chalk.red('Failed to install base dependencies:'), error);
      throw error;
    }
  }

  private async installPlatformDependencies(platform: Platform): Promise<void> {
    console.log(chalk.gray(`Installing ${platform} dependencies...`));

    switch (platform) {
      case Platform.NGINX:
        await this.installNginx();
        break;
      case Platform.PM2:
        await this.installPM2();
        break;
      case Platform.DOCKER:
        await this.installDockerCompose();
        break;
      case Platform.SYSTEMD:
        await this.setupSystemd();
        break;
    }
  }

  private async installFrameworkDependencies(framework: Framework): Promise<void> {
    console.log(chalk.gray(`Installing ${framework} dependencies...`));

    switch (framework) {
      case Framework.NEXTJS:
        await this.installNextJsDependencies();
        break;
      case Framework.REACT:
        await this.installReactDependencies();
        break;
      case Framework.VUE:
        await this.installVueDependencies();
        break;
      case Framework.NUXT:
        await this.installNuxtDependencies();
        break;
      case Framework.SVELTE:
        await this.installSvelteDependencies();
        break;
      case Framework.ANGULAR:
        await this.installAngularDependencies();
        break;
      case Framework.EXPRESS:
        await this.installExpressDependencies();
        break;
      case Framework.FASTIFY:
        await this.installFastifyDependencies();
        break;
      case Framework.NEST:
        await this.installNestDependencies();
        break;
      case Framework.DJANGO:
        await this.installDjangoDependencies();
        break;
      case Framework.FLASK:
        await this.installFlaskDependencies();
        break;
      case Framework.LARAVEL:
        await this.installLaravelDependencies();
        break;
      case Framework.STATIC:
        // No additional dependencies needed for static sites
        break;
    }
  }

  private detectBestPlatform(framework: Framework): Platform {
    // Frontend frameworks work well with nginx
    if ([Framework.REACT, Framework.VUE, Framework.ANGULAR, Framework.SVELTE, Framework.STATIC].includes(framework)) {
      return Platform.NGINX;
    }

    // Node.js frameworks work well with PM2
    if ([Framework.NEXTJS, Framework.NUXT, Framework.EXPRESS, Framework.FASTIFY, Framework.NEST].includes(framework)) {
      return Platform.PM2;
    }

    // Python frameworks work well with systemd
    if ([Framework.DJANGO, Framework.FLASK].includes(framework)) {
      return Platform.SYSTEMD;
    }

    // PHP frameworks work well with nginx
    if ([Framework.LARAVEL].includes(framework)) {
      return Platform.NGINX;
    }

    // Default to Docker for unknown cases
    return Platform.DOCKER;
  }

  private async ensureNodeJs(): Promise<void> {
    try {
      execSync('node --version', { stdio: 'ignore' });
      console.log(chalk.green('Node.js is already installed'));
    } catch {
      console.log(chalk.yellow('Installing Node.js...'));
      await this.installNodeJs();
    }
  }

  private async ensureGit(): Promise<void> {
    try {
      execSync('git --version', { stdio: 'ignore' });
      console.log(chalk.green('Git is already installed'));
    } catch {
      console.log(chalk.yellow('Installing Git...'));
      await this.installGit();
    }
  }

  private async ensureDocker(): Promise<void> {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      console.log(chalk.green('Docker is already installed'));
    } catch {
      console.log(chalk.yellow('Installing Docker...'));
      await this.installDocker();
    }
  }

  private async ensurePnpm(): Promise<void> {
    try {
      execSync('pnpm --version', { stdio: 'ignore' });
      console.log(chalk.green('pnpm is already installed'));
    } catch {
      console.log(chalk.yellow('Installing pnpm...'));
      await this.installPnpm();
    }
  }

  private async installNodeJs(): Promise<void> {
    if (this.platform === 'win32') {
      console.log(chalk.blue('Please install Node.js from https://nodejs.org/'));
      throw new Error('Node.js installation required');
    } else if (this.platform === 'darwin') {
      execSync('brew install node', { stdio: 'inherit' });
    } else {
      // Linux
      execSync('curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -', { stdio: 'inherit' });
      execSync('sudo apt-get install -y nodejs', { stdio: 'inherit' });
    }
  }

  private async installGit(): Promise<void> {
    if (this.platform === 'win32') {
      console.log(chalk.blue('Please install Git from https://git-scm.com/'));
      throw new Error('Git installation required');
    } else if (this.platform === 'darwin') {
      execSync('brew install git', { stdio: 'inherit' });
    } else {
      execSync('sudo apt-get update && sudo apt-get install -y git', { stdio: 'inherit' });
    }
  }

  private async installDocker(): Promise<void> {
    if (this.platform === 'win32') {
      console.log(chalk.blue('Please install Docker Desktop from https://docker.com/'));
      throw new Error('Docker installation required');
    } else if (this.platform === 'darwin') {
      execSync('brew install --cask docker', { stdio: 'inherit' });
    } else {
      execSync('curl -fsSL https://get.docker.com -o get-docker.sh', { stdio: 'inherit' });
      execSync('sh get-docker.sh', { stdio: 'inherit' });
      execSync('sudo usermod -aG docker $USER', { stdio: 'inherit' });
    }
  }

  private async installPnpm(): Promise<void> {
    if (this.platform === 'win32') {
      console.log(chalk.blue('Please install pnpm from https://pnpm.js.org/'));
      throw new Error('pnpm installation required');
    } else {
      execSync('npm install -g pnpm', { stdio: 'inherit' });
    }
  }

  private async installBuildTools(): Promise<void> {
    if (this.platform === 'darwin') {
      try {
        execSync('xcode-select --install', { stdio: 'ignore' });
      } catch {
        // Xcode tools already installed
      }
    } else if (this.platform === 'linux') {
      execSync('sudo apt-get install -y build-essential', { stdio: 'inherit' });
    }
  }

  private async installNginx(): Promise<void> {
    console.log(chalk.gray('Installing Nginx...'));
    
    if (this.platform === 'darwin') {
      execSync('brew install nginx', { stdio: 'inherit' });
    } else if (this.platform === 'linux') {
      execSync('sudo apt-get update && sudo apt-get install -y nginx', { stdio: 'inherit' });
    } else {
      console.log(chalk.yellow('Please install Nginx manually on Windows'));
    }
  }

  private async installPM2(): Promise<void> {
    console.log(chalk.gray('Installing PM2...'));
    execSync('pnpm add -g pm2', { stdio: 'inherit' });
  }

  private async installDockerCompose(): Promise<void> {
    console.log(chalk.gray('Installing Docker Compose...'));
    
    if (this.platform === 'darwin') {
      execSync('brew install docker-compose', { stdio: 'inherit' });
    } else if (this.platform === 'linux') {
      execSync('sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose', { stdio: 'inherit' });
      execSync('sudo chmod +x /usr/local/bin/docker-compose', { stdio: 'inherit' });
    }
  }

  private async setupSystemd(): Promise<void> {
    console.log(chalk.gray('Setting up Systemd configuration...'));
    // Systemd is typically pre-installed on Linux systems
    if (this.platform !== 'linux') {
      console.log(chalk.yellow('Systemd is only available on Linux systems'));
    }
  }

  // Framework-specific dependency installations
  private async installNextJsDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Next.js build dependencies...'));
    // Next.js will be installed via package.json
  }

  private async installReactDependencies(): Promise<void> {
    console.log(chalk.gray('Installing React build dependencies...'));
    // React dependencies will be handled via package.json
  }

  private async installVueDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Vue.js build dependencies...'));
    execSync('pnpm add -g @vue/cli', { stdio: 'inherit' });
  }

  private async installNuxtDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Nuxt.js build dependencies...'));
    execSync('pnpm add -g create-nuxt-app', { stdio: 'inherit' });
  }

  private async installSvelteDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Svelte build dependencies...'));
    // Svelte dependencies will be handled via package.json
  }

  private async installAngularDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Angular build dependencies...'));
    execSync('pnpm add -g @angular/cli', { stdio: 'inherit' });
  }

  private async installExpressDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Express.js dependencies...'));
    execSync('pnpm add -g express-generator', { stdio: 'inherit' });
  }

  private async installFastifyDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Fastify dependencies...'));
    execSync('pnpm add -g fastify-cli', { stdio: 'inherit' });
  }

  private async installNestDependencies(): Promise<void> {
    console.log(chalk.gray('Installing NestJS dependencies...'));
    execSync('pnpm add -g @nestjs/cli', { stdio: 'inherit' });
  }

  private async installDjangoDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Django dependencies...'));
    
    try {
      execSync('python3 --version', { stdio: 'ignore' });
    } catch {
      if (this.platform === 'darwin') {
        execSync('brew install python3', { stdio: 'inherit' });
      } else if (this.platform === 'linux') {
        execSync('sudo apt-get install -y python3 python3-pip', { stdio: 'inherit' });
      }
    }
    
    execSync('pip3 install django gunicorn', { stdio: 'inherit' });
  }

  private async installFlaskDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Flask dependencies...'));
    
    try {
      execSync('python3 --version', { stdio: 'ignore' });
    } catch {
      if (this.platform === 'darwin') {
        execSync('brew install python3', { stdio: 'inherit' });
      } else if (this.platform === 'linux') {
        execSync('sudo apt-get install -y python3 python3-pip', { stdio: 'inherit' });
      }
    }
    
    execSync('pip3 install flask gunicorn', { stdio: 'inherit' });
  }

  private async installLaravelDependencies(): Promise<void> {
    console.log(chalk.gray('Installing Laravel dependencies...'));
    
    try {
      execSync('php --version', { stdio: 'ignore' });
    } catch {
      if (this.platform === 'darwin') {
        execSync('brew install php', { stdio: 'inherit' });
      } else if (this.platform === 'linux') {
        execSync('sudo apt-get install -y php php-cli php-fpm php-mysql php-xml php-mbstring', { stdio: 'inherit' });
      }
    }
    
    try {
      execSync('composer --version', { stdio: 'ignore' });
    } catch {
      execSync('curl -sS https://getcomposer.org/installer | php', { stdio: 'inherit' });
      execSync('sudo mv composer.phar /usr/local/bin/composer', { stdio: 'inherit' });
    }
  }
}
