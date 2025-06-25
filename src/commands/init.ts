import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { Framework } from '../types';
import { ConfigService } from '../services/config';
import { DependencyInstaller } from '../installers/dependencies';

interface InitOptions {
  template?: string;
  yes: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.blue.bold('Initializing Forge project...'));

  const configService = new ConfigService();
  const dependencyInstaller = new DependencyInstaller();

  try {
    // Check if already initialized
    if (await fs.pathExists('forge.config.json')) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: 'Forge project already initialized. Overwrite?',
        default: false
      }]);

      if (!overwrite) {
        console.log(chalk.yellow('Initialization cancelled.'));
        return;
      }
    }

    let projectName: string;
    let framework: Framework;
    let buildCommand: string;
    let outputDirectory: string;

    if (options.yes) {
      // Use defaults
      projectName = path.basename(process.cwd());
      framework = await detectFramework();
      buildCommand = getDefaultBuildCommand(framework);
      outputDirectory = getDefaultOutputDirectory(framework);
    } else {
      // Interactive setup
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: 'Project name:',
          default: path.basename(process.cwd()),
          validate: (input: string) => input.length > 0 || 'Project name is required'
        },
        {
          type: 'list',
          name: 'framework',
          message: 'Select framework:',
          choices: [
            { name: 'Next.js', value: Framework.NEXTJS },
            { name: 'React', value: Framework.REACT },
            { name: 'Vue.js', value: Framework.VUE },
            { name: 'Nuxt.js', value: Framework.NUXT },
            { name: 'Svelte', value: Framework.SVELTE },
            { name: 'Angular', value: Framework.ANGULAR },
            { name: 'Express.js', value: Framework.EXPRESS },
            { name: 'Fastify', value: Framework.FASTIFY },
            { name: 'NestJS', value: Framework.NEST },
            { name: 'Django', value: Framework.DJANGO },
            { name: 'Flask', value: Framework.FLASK },
            { name: 'Laravel', value: Framework.LARAVEL },
            { name: 'Static Site', value: Framework.STATIC }
          ],
          default: await detectFramework()
        },
        {
          type: 'input',
          name: 'buildCommand',
          message: 'Build command:',
          default: (answers: any) => getDefaultBuildCommand(answers.framework)
        },
        {
          type: 'input',
          name: 'outputDirectory',
          message: 'Output directory:',
          default: (answers: any) => getDefaultOutputDirectory(answers.framework)
        }
      ]);

      projectName = answers.projectName;
      framework = answers.framework;
      buildCommand = answers.buildCommand;
      outputDirectory = answers.outputDirectory;
    }

    // Create forge.config.json
    const config = {
      projectName,
      framework,
      buildCommand,
      outputDirectory,
      environmentVariables: {}
    };

    await configService.saveProjectConfig(config);

    // Install system dependencies
    console.log(chalk.blue('Setting up deployment dependencies...'));
    await dependencyInstaller.installSystemDependencies(framework);

    // Generate deployment templates
    await generateDeploymentTemplates(framework);

    console.log(chalk.green.bold('Project initialized successfully!'));
    console.log();
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.gray('  1. forge login'));
    console.log(chalk.gray('  2. forge deploy'));

  } catch (error) {
    console.error(chalk.red('Failed to initialize project:'), error);
    process.exit(1);
  }
}

async function detectFramework(): Promise<Framework> {
  try {
    const packageJson = await fs.readJSON('package.json');
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (dependencies.next) return Framework.NEXTJS;
    if (dependencies.nuxt) return Framework.NUXT;
    if (dependencies.react) return Framework.REACT;
    if (dependencies.vue) return Framework.VUE;
    if (dependencies.svelte) return Framework.SVELTE;
    if (dependencies['@angular/core']) return Framework.ANGULAR;
    if (dependencies.express) return Framework.EXPRESS;
    if (dependencies.fastify) return Framework.FASTIFY;
    if (dependencies['@nestjs/core']) return Framework.NEST;

    // Check for Python frameworks
    if (await fs.pathExists('requirements.txt')) {
      const requirements = await fs.readFile('requirements.txt', 'utf8');
      if (requirements.includes('Django')) return Framework.DJANGO;
      if (requirements.includes('Flask')) return Framework.FLASK;
    }

    // Check for PHP frameworks
    if (await fs.pathExists('composer.json')) {
      const composer = await fs.readJSON('composer.json');
      if (composer.require && composer.require['laravel/framework']) {
        return Framework.LARAVEL;
      }
    }

  } catch (error) {
    // Ignore errors and return static as default
  }

  return Framework.STATIC;
}

function getDefaultBuildCommand(framework: Framework): string {
  switch (framework) {
    case Framework.NEXTJS:
      return 'npm run build';
    case Framework.REACT:
      return 'npm run build';
    case Framework.VUE:
      return 'npm run build';
    case Framework.NUXT:
      return 'npm run build';
    case Framework.SVELTE:
      return 'npm run build';
    case Framework.ANGULAR:
      return 'ng build --prod';
    case Framework.EXPRESS:
      return 'npm run build';
    case Framework.FASTIFY:
      return 'npm run build';
    case Framework.NEST:
      return 'npm run build';
    case Framework.DJANGO:
      return 'python manage.py collectstatic --noinput';
    case Framework.FLASK:
      return 'pip install -r requirements.txt';
    case Framework.LARAVEL:
      return 'composer install --no-dev && php artisan config:cache';
    default:
      return 'echo "No build command needed"';
  }
}

function getDefaultOutputDirectory(framework: Framework): string {
  switch (framework) {
    case Framework.NEXTJS:
      return '.next';
    case Framework.REACT:
      return 'build';
    case Framework.VUE:
      return 'dist';
    case Framework.NUXT:
      return '.nuxt';
    case Framework.SVELTE:
      return 'public';
    case Framework.ANGULAR:
      return 'dist';
    case Framework.EXPRESS:
    case Framework.FASTIFY:
    case Framework.NEST:
      return 'dist';
    case Framework.DJANGO:
      return 'staticfiles';
    case Framework.FLASK:
      return '.';
    case Framework.LARAVEL:
      return 'public';
    default:
      return '.';
  }
}

async function generateDeploymentTemplates(framework: Framework): Promise<void> {
  console.log(chalk.gray('Generating deployment templates...'));

  // Create .forgeignore file
  const forgeIgnoreContent = `
node_modules/
.git/
.env*
*.log
.DS_Store
dist/
build/
.next/
coverage/
.nyc_output/
*.tgz
*.tar.gz
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
.venv/
venv/
ENV/
env/
.cache/
.pytest_cache/
.coverage
vendor/
storage/
.idea/
.vscode/
`.trim();

  await fs.writeFile('.forgeignore', forgeIgnoreContent);

  // Generate framework-specific configuration files
  switch (framework) {
    case Framework.NEXTJS:
      await generateNextJsConfig();
      break;
    case Framework.DJANGO:
      await generateDjangoConfig();
      break;
    case Framework.FLASK:
      await generateFlaskConfig();
      break;
    case Framework.LARAVEL:
      await generateLaravelConfig();
      break;
  }
}

async function generateNextJsConfig(): Promise<void> {
  const ecosystem = {
    apps: [{
      name: 'nextjs-app',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      exec_mode: 'cluster'
    }]
  };

  await fs.writeJSON('ecosystem.config.js', ecosystem, { spaces: 2 });
}

async function generateDjangoConfig(): Promise<void> {
  const gunicornConfig = `
bind = "0.0.0.0:8000"
workers = 2
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 30
keepalive = 2
`.trim();

  await fs.writeFile('gunicorn.conf.py', gunicornConfig);
}

async function generateFlaskConfig(): Promise<void> {
  const gunicornConfig = `
bind = "0.0.0.0:5000"
workers = 2
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 30
keepalive = 2
`.trim();

  await fs.writeFile('gunicorn.conf.py', gunicornConfig);
}

async function generateLaravelConfig(): Promise<void> {
  const nginxConfig = `
server {
    listen 80;
    server_name _;
    root /var/www/html/public;
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
`.trim();

  await fs.ensureDir('deploy');
  await fs.writeFile('deploy/nginx.conf', nginxConfig);
}
