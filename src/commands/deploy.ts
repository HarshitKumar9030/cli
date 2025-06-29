import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { ConfigService } from '../services/config';
import { ForgeApiService } from '../services/api';
import { GitService } from '../services/git';
import { LocalDeploymentManager } from '../services/localDeployment';
import { getSystemIP, getPublicIP, checkSystemPrivileges } from '../utils/system';
import { Framework } from '../types';

export const deployCommand = new Command('deploy')
  .description('Deploy your application to Forge')
  .argument('[source]', 'GitHub repository URL or local project directory')
  .option('-b, --branch <branch>', 'Git branch to deploy', 'main')
  .option('-e, --environment <env>', 'Target environment', 'production')
  .option('--skip-build', 'Skip the build step')
  .option('-f, --force', 'Force deployment even if checks fail')
  .option('--subdomain <subdomain>', 'Custom subdomain (for web projects)')
  .action(async (source, options) => {
    try {
      console.log(chalk.blue('Forge Deployment'));
      console.log(chalk.gray('Preparing your application for deployment...'));
      console.log();

      // Check system privileges for infrastructure setup
      checkSystemPrivileges();

      const configService = new ConfigService();
      let projectPath = process.cwd();
      let isGitRepo = false;
      let gitRepository: string | undefined;
      let projectName: string;
      let framework: Framework;

      // Determine source type and project details
      if (source) {
        if (isGitHubUrl(source)) {
          console.log(chalk.cyan('Detected GitHub repository URL'));
          gitRepository = source;
          isGitRepo = true;
          projectName = extractRepoName(source);
          
          // Clone the repository for local deployment
          console.log(chalk.cyan('Cloning repository for deployment...'));
          const cloneResult = await GitService.cloneRepository(source, {
            branch: options.branch,
            depth: 1
          });
          
          if (!cloneResult.success) {
            console.log(chalk.red(`Failed to clone repository: ${cloneResult.error}`));
            process.exit(1);
          }
          
          projectPath = cloneResult.localPath!;
          framework = await detectFrameworkFromDirectory(projectPath);
        } else {
          console.log(chalk.cyan('Detected local directory'));
          projectPath = path.resolve(source);
          
          if (!await fs.pathExists(projectPath)) {
            console.log(chalk.red(`Error: Directory "${source}" does not exist`));
            process.exit(1);
          }
          
          // Check if it's a git repository
          try {
            const gitRemote = execSync('git remote get-url origin', { 
              cwd: projectPath, 
              encoding: 'utf8' 
            }).trim();
            gitRepository = gitRemote;
            isGitRepo = true;
          } catch {
            // Not a git repository
          }
          
          projectName = path.basename(projectPath);
          framework = await detectFrameworkFromDirectory(projectPath);
        }
      } else {
        // Use current directory
        console.log(chalk.cyan('Using current directory'));
        
        // Check if we have a project config
        const existingConfig = await configService.loadProjectConfig();
        if (existingConfig) {
          projectName = existingConfig.projectName || path.basename(projectPath);
          framework = existingConfig.framework as Framework || await detectFrameworkFromDirectory(projectPath);
        } else {
          projectName = path.basename(projectPath);
          framework = await detectFrameworkFromDirectory(projectPath);
        }
        
        // Check if it's a git repository
        try {
          gitRepository = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
          isGitRepo = true;
        } catch {
          // Not a git repository
        }
      }

      console.log(chalk.gray(`Project: ${projectName}`));
      console.log(chalk.gray(`Framework: ${framework}`));
      if (gitRepository) {
        console.log(chalk.gray(`Repository: ${gitRepository}`));
      }
      
      // Get public IP for local deployment routing
      const publicIP = await getPublicIP();
      const localIP = getSystemIP();
      console.log(chalk.gray(`Public IP: ${publicIP}`));
      console.log(chalk.gray(`Local IP: ${localIP}`));
      console.log();

      // Check authentication
      const globalConfig = await configService.loadGlobalConfig();
      if (!globalConfig?.apiKey) {
        console.log(chalk.red('Error: Not authenticated'));
        console.log('Run "forge login" to authenticate');
        process.exit(1);
      }

      const apiService = new ForgeApiService();
      apiService.setApiKey(globalConfig.apiKey);

      // Verify API key
      console.log(chalk.gray('Verifying authentication...'));
      const authResponse = await apiService.verifyApiKey();
      if (!authResponse.success) {
        console.log(chalk.red('Error: Authentication failed'));
        console.log('Run "forge login" to re-authenticate');
        process.exit(1);
      }

      // Custom subdomain (if provided)
      const customSubdomain = options.subdomain;
      if (customSubdomain) {
        console.log(chalk.gray(`Using custom subdomain: ${customSubdomain}`));
      }

      // Build configuration
      const buildConfig = await getBuildConfiguration(framework, projectPath);

      // Install dependencies if package.json exists
      if (!options.skipBuild) {
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          console.log(chalk.cyan('Installing dependencies...'));
          try {
            // Use npm for consistency
            execSync('npm install', { 
              stdio: 'inherit', 
              cwd: projectPath 
            });
            console.log(chalk.green('Dependencies installed successfully'));
          } catch (error) {
            console.log(chalk.red('Failed to install dependencies'));
            if (!options.force) {
              process.exit(1);
            }
            console.log(chalk.yellow('Continuing deployment due to --force flag'));
          }
        }
      }

      // Build project if not skipped
      if (!options.skipBuild && buildConfig.buildCommand) {
        console.log(chalk.cyan('Building project...'));
        try {
          execSync(buildConfig.buildCommand, { 
            stdio: 'inherit', 
            cwd: projectPath 
          });
          console.log(chalk.green('Build completed successfully'));
        } catch (error) {
          console.log(chalk.red('Build failed'));
          if (!options.force) {
            process.exit(1);
          }
          console.log(chalk.yellow('Continuing deployment due to --force flag'));
        }
      }

      // Create deployment
      console.log(chalk.cyan('Creating deployment...'));
      
      const deploymentData = {
        projectName,
        gitRepository,
        gitBranch: options.branch,
        framework,
        buildCommand: buildConfig.buildCommand,
        outputDirectory: buildConfig.outputDirectory,
        environmentVariables: buildConfig.environmentVariables || {},
        publicIP,
        localIP,
        projectPath: isGitRepo ? projectPath : undefined,
        ...(customSubdomain && { customSubdomain })
      };

      const deployResponse = await apiService.createDeployment(deploymentData);

      if (deployResponse.success) {
        const deployment = deployResponse.data.deployment;
        
        console.log();
        console.log(chalk.green('Deployment created successfully!'));
        console.log();
        console.log(chalk.blue('Deployment Details:'));
        console.log(`  ${chalk.cyan('ID:')} ${deployment.id}`);
        console.log(`  ${chalk.cyan('Subdomain:')} ${deployment.subdomain}`);
        console.log(`  ${chalk.cyan('URL:')} ${deployment.url}`);
        console.log(`  ${chalk.cyan('Status:')} ${deployment.status}`);
        console.log(`  ${chalk.cyan('Framework:')} ${framework}`);
        console.log();

        // Save deployment configuration
        const projectConfig = {
          projectName,
          framework,
          buildCommand: buildConfig.buildCommand,
          outputDirectory: buildConfig.outputDirectory,
          environmentVariables: buildConfig.environmentVariables,
          deploymentId: deployment.id,
          subdomain: deployment.subdomain
        };

        await configService.saveProjectConfig(projectConfig);

        // Start local deployment
        console.log();
        console.log(chalk.cyan('Starting local deployment...'));
        try {
          const localDeployment = await LocalDeploymentManager.deployLocally({
            id: deployment.id,
            projectName,
            subdomain: deployment.subdomain,
            framework,
            projectPath,
            buildOutputDir: buildConfig.outputDirectory,
            publicIP
          });
          
          console.log(chalk.green('Local deployment started successfully!'));
          console.log();
          console.log(chalk.blue('📁 Project Information:'));
          console.log(`  ${chalk.cyan('Project Path:')} ${projectPath}`);
        console.log(`  ${chalk.cyan('Framework:')} ${framework}`);
        console.log(`  ${chalk.cyan('Deployment ID:')} ${deployment.id}`);
        console.log();
        console.log(chalk.blue('🚀 Access Your Application:'));
        console.log(`  ${chalk.cyan('Local:')} http://localhost:${localDeployment.port}`);
        console.log(`  ${chalk.cyan('Network:')} http://${localIP}:${localDeployment.port}`);
        console.log(`  ${chalk.cyan('Public:')} ${localDeployment.url}`);
        console.log();
        console.log(chalk.yellow('🔧 For Public Access:'));
        console.log(`  ${chalk.gray('1. Open port')} ${localDeployment.port} ${chalk.gray('in your firewall')}`);
        console.log(`  ${chalk.gray('2. Domain routing is handled automatically')}`);
        console.log();
        console.log(chalk.blue('⚡ Pro Tips:'));
        console.log(`  ${chalk.cyan('forge infra --all')} - Setup nginx & PM2 for better management`);
        console.log(`  ${chalk.cyan('forge status')} - Check all deployment status`);
        console.log(`  ${chalk.cyan('forge pause')} - Pause this deployment`);
        console.log(`  ${chalk.cyan('forge stop')} - Stop this deployment`);
        console.log(`  ${chalk.cyan('forge logs')} - View deployment logs`);

        } catch (localError) {
          console.log(chalk.yellow('⚠️  Local deployment failed, but remote deployment created'));
          console.log(chalk.gray(`Local error: ${localError}`));
          console.log(chalk.gray('Use "forge status" to check deployment progress'));
          console.log(chalk.gray('Use "forge logs" to view deployment logs'));
        }

      } else {
        throw new Error(deployResponse.error?.message || 'Deployment failed');
      }

    } catch (error) {
      console.log(chalk.red(`Deployment failed: ${error}`));
      process.exit(1);
    }
  });

// Helper functions

function isGitHubUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(github|gitlab|bitbucket)\.com\/[^\/]+\/[^\/]+/.test(url);
}

function extractRepoName(url: string): string {
  const match = url.match(/\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/)?$/);
  return match ? match[2] : 'project';
}

async function detectFrameworkFromDirectory(projectPath: string): Promise<Framework> {
  try {
    // Check for package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJSON(packageJsonPath);
      
      // Check dependencies and devDependencies for framework indicators
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      // Next.js detection
      if (allDeps.next || packageJson.scripts?.dev?.includes('next')) {
        return Framework.NEXTJS;
      }

      // Nuxt detection
      if (allDeps.nuxt || allDeps['@nuxt/kit'] || packageJson.scripts?.dev?.includes('nuxt')) {
        return Framework.NUXT;
      }

      // Vue detection
      if (allDeps.vue || allDeps['@vue/cli-service']) {
        return Framework.VUE;
      }

      // React detection (must come after Next.js check)
      if (allDeps.react) {
        return Framework.REACT;
      }

      // Angular detection
      if (allDeps['@angular/core'] || allDeps['@angular/cli']) {
        return Framework.ANGULAR;
      }

      // Svelte detection
      if (allDeps.svelte || allDeps['@sveltejs/kit']) {
        return Framework.SVELTE;
      }

      // Express detection
      if (allDeps.express && !allDeps.react && !allDeps.vue) {
        return Framework.EXPRESS;
      }

      // Fastify detection
      if (allDeps.fastify) {
        return Framework.FASTIFY;
      }

      // NestJS detection
      if (allDeps['@nestjs/core']) {
        return Framework.NEST;
      }

      // Default to static if Node.js project but no specific framework
      return Framework.STATIC;
    }

    // Check for Python files
    const pythonFiles = await fs.readdir(projectPath);
    const hasPythonFiles = pythonFiles.some(file => file.endsWith('.py'));
    
    if (hasPythonFiles) {
      // Check for requirements.txt or common Python frameworks
      const requirementsPath = path.join(projectPath, 'requirements.txt');
      if (await fs.pathExists(requirementsPath)) {
        const requirements = await fs.readFile(requirementsPath, 'utf8');
        
        if (requirements.includes('django') || requirements.includes('Django')) {
          return Framework.DJANGO;
        }
        if (requirements.includes('flask') || requirements.includes('Flask')) {
          return Framework.FLASK;
        }
        if (requirements.includes('fastapi') || requirements.includes('FastAPI')) {
          return Framework.FASTAPI;
        }
      }

      // Check for manage.py (Django indicator)
      if (await fs.pathExists(path.join(projectPath, 'manage.py'))) {
        return Framework.DJANGO;
      }

      // Default to Flask for Python projects
      return Framework.FLASK;
    }

    // Check for PHP files
    const phpFiles = pythonFiles.some(file => file.endsWith('.php'));
    if (phpFiles) {
      // Check for composer.json
      const composerPath = path.join(projectPath, 'composer.json');
      if (await fs.pathExists(composerPath)) {
        const composer = await fs.readJSON(composerPath);
        
        if (composer.require?.['laravel/framework']) {
          return Framework.LARAVEL;
        }
        if (composer.require?.['symfony/framework-bundle']) {
          return Framework.SYMFONY;
        }
      }

      // Check for wp-config.php (WordPress indicator)
      if (await fs.pathExists(path.join(projectPath, 'wp-config.php'))) {
        return Framework.WORDPRESS;
      }

      // Default to Laravel for PHP projects
      return Framework.LARAVEL;
    }

    // Default to static
    return Framework.STATIC;

  } catch (error) {
    console.log(chalk.yellow('Could not detect framework, defaulting to static'));
    return Framework.STATIC;
  }
}

function isWebFramework(framework: Framework): boolean {
  return [
    Framework.NEXTJS,
    Framework.NUXT,
    Framework.REACT,
    Framework.VUE,
    Framework.ANGULAR,
    Framework.SVELTE,
    Framework.STATIC,
    Framework.DJANGO,
    Framework.FLASK,
    Framework.FASTAPI,
    Framework.LARAVEL,
    Framework.SYMFONY,
    Framework.WORDPRESS
  ].includes(framework);
}

async function getBuildConfiguration(framework: Framework, projectPath: string): Promise<{
  buildCommand?: string;
  outputDirectory?: string;
  environmentVariables?: Record<string, string>;
}> {
  const config: {
    buildCommand?: string;
    outputDirectory?: string;
    environmentVariables?: Record<string, string>;
  } = {};

  switch (framework) {
    case Framework.NEXTJS:
      config.buildCommand = 'npm run build';
      config.outputDirectory = '.next';
      break;
    
    case Framework.NUXT:
      config.buildCommand = 'npm run build';
      config.outputDirectory = '.output';
      break;
    
    case Framework.REACT:
      config.buildCommand = 'npm run build';
      config.outputDirectory = 'build';
      break;
    
    case Framework.VUE:
      config.buildCommand = 'npm run build';
      config.outputDirectory = 'dist';
      break;
    
    case Framework.ANGULAR:
      config.buildCommand = 'npm run build';
      config.outputDirectory = 'dist';
      break;
    
    case Framework.SVELTE:
      config.buildCommand = 'npm run build';
      config.outputDirectory = 'build';
      break;
    
    case Framework.EXPRESS:
    case Framework.FASTIFY:
    case Framework.NEST:
      config.buildCommand = 'npm run build';
      config.outputDirectory = 'dist';
      break;
    
    case Framework.DJANGO:
      config.buildCommand = 'pip install -r requirements.txt && python manage.py collectstatic --noinput';
      break;
    
    case Framework.FLASK:
    case Framework.FASTAPI:
      config.buildCommand = 'pip install -r requirements.txt';
      break;
    
    case Framework.LARAVEL:
      config.buildCommand = 'composer install --no-dev && npm run build';
      config.outputDirectory = 'public';
      break;
    
    case Framework.SYMFONY:
      config.buildCommand = 'composer install --no-dev';
      config.outputDirectory = 'public';
      break;
    
    case Framework.STATIC:
    default:
      // No build command for static sites
      break;
  }

  // Check if package.json exists and has custom scripts
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJSON(packageJsonPath);
      
      // Override build command if package.json has a build script
      if (packageJson.scripts?.build && !config.buildCommand) {
        // Use npm as default since we're using it for installation
        config.buildCommand = 'npm run build';
      }
    }
  } catch {
    // Ignore errors reading package.json
  }

  return config;
}
