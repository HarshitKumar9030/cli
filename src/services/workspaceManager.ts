import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { BuildStep, WorkspaceSetup, MonorepoConfig } from '../types';

export class WorkspaceManager {
  private projectPath: string;
  private packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' = 'npm';

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.detectPackageManager();
  }

  /**
   * Get predefined workspace templates for common project types
   */
  static getWorkspaceTemplates(): Record<string, Partial<WorkspaceSetup>> {
    return {
      'nextjs-fullstack': {
        preDeploySteps: [
          {
            name: 'Environment Setup',
            command: 'npm run env:setup',
            optional: true,
            timeout: 60
          },
          {
            name: 'Database Migration',
            command: 'npm run db:migrate',
            optional: false,
            timeout: 120
          },
          {
            name: 'Prisma Generate',
            command: 'npx prisma generate',
            optional: false,
            timeout: 60
          }
        ],
        buildSteps: [
          {
            name: 'Next.js Build',
            command: 'npm run build',
            optional: false,
            timeout: 600,
            environment: {
              'NEXT_TELEMETRY_DISABLED': '1',
              'NODE_ENV': 'production'
            }
          }
        ],
        postDeploySteps: [
          {
            name: 'Cache Warming',
            command: 'npm run warm-cache',
            optional: true,
            timeout: 60
          }
        ]
      },

      'react-monorepo': {
        preDeploySteps: [
          {
            name: 'Monorepo Bootstrap',
            command: 'npm run bootstrap',
            optional: false,
            timeout: 300
          },
          {
            name: 'Linting',
            command: 'npm run lint',
            optional: true,
            timeout: 120
          },
          {
            name: 'Type Checking',
            command: 'npm run type-check',
            optional: true,
            timeout: 120
          }
        ],
        buildSteps: [
          {
            name: 'Build All Packages',
            command: 'npm run build:all',
            optional: false,
            timeout: 600
          }
        ]
      },

      'vite-spa': {
        preDeploySteps: [
          {
            name: 'Code Generation',
            command: 'npm run codegen',
            optional: true,
            timeout: 120
          }
        ],
        buildSteps: [
          {
            name: 'Vite Build',
            command: 'npm run build',
            optional: false,
            timeout: 300,
            environment: {
              'NODE_ENV': 'production'
            }
          }
        ]
      },

      'nuxt-ssr': {
        preDeploySteps: [
          {
            name: 'Nuxt Prepare',
            command: 'npm run prepare',
            optional: false,
            timeout: 60
          },
          {
            name: 'Database Setup',
            command: 'npm run db:setup',
            optional: true,
            timeout: 180
          }
        ],
        buildSteps: [
          {
            name: 'Nuxt Build',
            command: 'npm run build',
            optional: false,
            timeout: 600
          }
        ]
      },

      'node-api': {
        preDeploySteps: [
          {
            name: 'Database Migration',
            command: 'npm run db:migrate',
            optional: false,
            timeout: 120
          },
          {
            name: 'Seed Database',
            command: 'npm run db:seed',
            optional: true,
            timeout: 60
          }
        ],
        buildSteps: [
          {
            name: 'TypeScript Build',
            command: 'npm run build',
            optional: false,
            timeout: 180
          }
        ],
        postDeploySteps: [
          {
            name: 'Health Check',
            command: 'npm run health-check',
            optional: true,
            timeout: 30
          }
        ]
      }
    };
  }


  private detectPackageManager(): void {
    const lockFiles = {
      'pnpm-lock.yaml': 'pnpm',
      'yarn.lock': 'yarn',
      'bun.lockb': 'bun',
      'package-lock.json': 'npm'
    } as const;

    for (const [file, manager] of Object.entries(lockFiles)) {
      if (fs.existsSync(path.join(this.projectPath, file))) {
        this.packageManager = manager;
        console.log(chalk.gray(`Detected package manager: ${manager}`));
        return;
      }
    }

    console.log(chalk.gray('No lock file found, defaulting to npm'));
  }


  async analyzeWorkspace(): Promise<WorkspaceSetup> {
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    
    if (!await fs.pathExists(packageJsonPath)) {
      throw new Error('No package.json found in project directory');
    }

    const packageJson = await fs.readJSON(packageJsonPath);
    const workspace: WorkspaceSetup = {
      packageManager: this.packageManager,
      installCommand: this.getInstallCommand(),
      preDeploySteps: [],
      buildSteps: [],
      postDeploySteps: []
    };

    workspace.monorepo = await this.detectMonorepo(packageJson);

    workspace.preDeploySteps = await this.suggestPreDeploySteps(packageJson);
    workspace.buildSteps = await this.suggestBuildSteps(packageJson);
    workspace.postDeploySteps = await this.suggestPostDeploySteps(packageJson);

    await this.optimizeForFramework(workspace, packageJson);

    return workspace;
  }


  private async detectMonorepo(packageJson: any): Promise<MonorepoConfig | undefined> {
    const rootPath = this.projectPath;

    if (await fs.pathExists(path.join(rootPath, 'nx.json'))) {
      return {
        type: 'nx',
        rootPackageJson: 'package.json',
        projectPath: await this.detectNxProjectPath()
      };
    }

    if (await fs.pathExists(path.join(rootPath, 'turbo.json'))) {
      return {
        type: 'turbo',
        rootPackageJson: 'package.json',
        projectPath: await this.detectTurboProjectPath()
      };
    }

    if (await fs.pathExists(path.join(rootPath, 'lerna.json'))) {
      return {
        type: 'lerna',
        rootPackageJson: 'package.json'
      };
    }

    if (await fs.pathExists(path.join(rootPath, 'rush.json'))) {
      return {
        type: 'rush',
        rootPackageJson: 'package.json'
      };
    }

    if (packageJson.workspaces) {
      return {
        type: 'custom',
        rootPackageJson: 'package.json'
      };
    }

    return undefined;
  }

  /**
   * Suggest pre-deploy steps based on package.json scripts
   */
  private async suggestPreDeploySteps(packageJson: any): Promise<BuildStep[]> {
    const steps: BuildStep[] = [];
    const scripts = packageJson.scripts || {};
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Database setup steps (priority order)
    if (scripts['db:setup']) {
      steps.push({
        name: 'Database Setup',
        command: `${this.packageManager} run db:setup`,
        optional: false,
        timeout: 300
      });
    } else {
      // Separate migration and seeding if no combined setup
      if (scripts['db:migrate'] || scripts['db:push']) {
        steps.push({
          name: 'Database Migration',
          command: `${this.packageManager} run ${scripts['db:migrate'] ? 'db:migrate' : 'db:push'}`,
          optional: false,
          timeout: 120
        });
      }
      
      if (scripts['db:seed']) {
        steps.push({
          name: 'Database Seeding',
          command: `${this.packageManager} run db:seed`,
          optional: true,
          timeout: 60
        });
      }
    }

    // Prisma specific steps
    if (dependencies.prisma || dependencies['@prisma/client']) {
      steps.push({
        name: 'Prisma Generate',
        command: `${this.packageManager === 'npm' ? 'npx' : this.packageManager} prisma generate`,
        optional: false,
        timeout: 60
      });

      if (!scripts['db:migrate'] && !scripts['db:setup'] && (scripts['db:push'] || scripts['db:deploy'])) {
        steps.push({
          name: 'Prisma DB Push',
          command: `${this.packageManager === 'npm' ? 'npx' : this.packageManager} prisma db ${scripts['db:push'] ? 'push' : 'deploy'}`,
          optional: true,
          timeout: 120
        });
      }
    }

    if (scripts['env:setup'] || scripts['setup:env']) {
      steps.push({
        name: 'Environment Setup',
        command: `${this.packageManager} run ${scripts['env:setup'] ? 'env:setup' : 'setup:env'}`,
        optional: true,
        timeout: 60
      });
    }

    const codegenScripts = ['codegen', 'generate', 'gql:generate', 'openapi:generate', 'generate:types'];
    for (const script of codegenScripts) {
      if (scripts[script]) {
        steps.push({
          name: 'Code Generation',
          command: `${this.packageManager} run ${script}`,
          optional: false,
          timeout: 120
        });
        break; 
      }
    }

    // Husky and git hooks setup
    if (dependencies.husky && scripts.prepare) {
      steps.push({
        name: 'Git Hooks Setup',
        command: `${this.packageManager} run prepare`,
        optional: true,
        timeout: 30
      });
    }

    if (dependencies['pre-commit'] || scripts['setup:pre-commit']) {
      steps.push({
        name: 'Pre-commit Setup',
        command: scripts['setup:pre-commit'] ? `${this.packageManager} run setup:pre-commit` : 'pre-commit install',
        optional: true,
        timeout: 30
      });
    }

    const typeCheckScripts = ['type-check', 'typecheck', 'tsc', 'types:check'];
    for (const script of typeCheckScripts) {
      if (scripts[script]) {
        steps.push({
          name: 'Type Checking',
          command: `${this.packageManager} run ${script}`,
          optional: true,
          timeout: 120
        });
        break;
      }
    }

    if (scripts.lint || scripts['lint:check']) {
      steps.push({
        name: 'Linting',
        command: `${this.packageManager} run ${scripts.lint ? 'lint' : 'lint:check'}`,
        optional: true,
        timeout: 120
      });
    }

    if (scripts.test && scripts['test:unit']) {
      steps.push({
        name: 'Unit Tests',
        command: `${this.packageManager} run test:unit`,
        optional: true,
        timeout: 300
      });
    } else if (scripts.test) {
      steps.push({
        name: 'Tests',
        command: `${this.packageManager} run test`,
        optional: true,
        timeout: 300
      });
    }

    return steps;
  }

  /**
   * Suggest build steps based on framework and package.json
   */
  private async suggestBuildSteps(packageJson: any): Promise<BuildStep[]> {
    const steps: BuildStep[] = [];
    const scripts = packageJson.scripts || {};
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Framework-specific build detection
    if (dependencies['next'] || scripts['next:build']) {
      steps.push({
        name: 'Next.js Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 600
      });
    } else if (dependencies['vite'] || scripts['vite:build']) {
      steps.push({
        name: 'Vite Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 300
      });
    } else if (dependencies['@angular/cli'] || scripts['ng:build']) {
      steps.push({
        name: 'Angular Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 600
      });
    } else if (dependencies['vue'] && dependencies['@vue/cli-service']) {
      steps.push({
        name: 'Vue CLI Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 300
      });
    } else if (dependencies['react-scripts']) {
      steps.push({
        name: 'Create React App Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 300
      });
    } else if (dependencies['nuxt'] || dependencies['nuxt3']) {
      steps.push({
        name: 'Nuxt Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 600
      });
    } else if (dependencies['svelte'] && dependencies['@sveltejs/kit']) {
      steps.push({
        name: 'SvelteKit Build',
        command: scripts.build || `${this.packageManager} run build`,
        optional: false,
        timeout: 300
      });
    } else if (scripts.build) {
      // Generic build command
      steps.push({
        name: 'Project Build',
        command: `${this.packageManager} run build`,
        optional: false,
        timeout: 300
      });
    }

    // TypeScript compilation (if no framework build)
    if (steps.length === 0 && dependencies.typescript && scripts.tsc) {
      steps.push({
        name: 'TypeScript Compilation',
        command: `${this.packageManager} run tsc`,
        optional: false,
        timeout: 120
      });
    }

    // Webpack build (standalone)
    if (steps.length === 0 && dependencies.webpack && scripts.webpack) {
      steps.push({
        name: 'Webpack Build',
        command: `${this.packageManager} run webpack`,
        optional: false,
        timeout: 300
      });
    }

    // Rollup build
    if (steps.length === 0 && dependencies.rollup && scripts.rollup) {
      steps.push({
        name: 'Rollup Build',
        command: `${this.packageManager} run rollup`,
        optional: false,
        timeout: 180
      });
    }

    return steps;
  }

  /**
   * Suggest post-deploy steps
   */
  private async suggestPostDeploySteps(packageJson: any): Promise<BuildStep[]> {
    const steps: BuildStep[] = [];
    const scripts = packageJson.scripts || {};

    // Post-deploy hooks
    if (scripts['post-deploy'] || scripts.postdeploy) {
      const postDeployScript = scripts['post-deploy'] || scripts.postdeploy;
      steps.push({
        name: 'Post Deploy Hook',
        command: `${this.packageManager} run ${Object.keys(scripts).find(key => scripts[key] === postDeployScript)}`,
        optional: false,
        timeout: 180
      });
    }

    // Cache warming
    if (scripts['warm-cache'] || scripts.warm) {
      const warmScript = scripts['warm-cache'] || scripts.warm;
      steps.push({
        name: 'Cache Warming',
        command: `${this.packageManager} run ${Object.keys(scripts).find(key => scripts[key] === warmScript)}`,
        optional: true,
        timeout: 60
      });
    }

    return steps;
  }

  /**
   * Execute a build step with proper error handling and logging
   */
  async executeBuildStep(step: BuildStep): Promise<boolean> {
    console.log(chalk.cyan(`Running: ${step.name}`));
    console.log(chalk.gray(`Command: ${step.command}`));

    const workingDir = step.workingDirectory 
      ? path.resolve(this.projectPath, step.workingDirectory)
      : this.projectPath;

    let attempt = 0;
    const maxAttempts = (step.retries || 0) + 1;

    while (attempt < maxAttempts) {
      try {
        const env = {
          ...process.env,
          ...step.environment
        };

        execSync(step.command, {
          cwd: workingDir,
          stdio: 'inherit',
          env,
          timeout: (step.timeout || 300) * 1000
        });

        console.log(chalk.green(`✓ ${step.name} completed successfully`));
        return true;

      } catch (error) {
        attempt++;
        
        if (attempt < maxAttempts) {
          console.log(chalk.yellow(`Retry ${attempt}/${step.retries} for ${step.name}...`));
          continue;
        }

        if (step.optional) {
          console.log(chalk.yellow(`! ${step.name} failed but is optional, continuing...`));
          return true;
        } else {
          console.log(chalk.red(`✗ ${step.name} failed`));
          throw error;
        }
      }
    }

    return false;
  }

  /**
   * Execute all build steps in sequence
   */
  async executeWorkflow(steps: BuildStep[]): Promise<void> {
    if (steps.length === 0) {
      console.log(chalk.gray('No build steps to execute'));
      return;
    }

    console.log(chalk.blue(`Executing ${steps.length} build step(s)...`));
    console.log();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      console.log(chalk.blue(`[${i + 1}/${steps.length}] ${step.name}`));
      
      try {
        await this.executeBuildStep(step);
      } catch (error) {
        console.log(chalk.red(`Build failed at step: ${step.name}`));
        throw error;
      }
      
      console.log();
    }

    console.log(chalk.green('All build steps completed successfully!'));
  }

  /**
   * Get the appropriate install command for the detected package manager
   */
  private getInstallCommand(): string {
    switch (this.packageManager) {
      case 'pnpm':
        return 'pnpm install';
      case 'yarn':
        return 'yarn install';
      case 'bun':
        return 'bun install';
      default:
        return 'npm install';
    }
  }

  /**
   * Detect Nx project path if in a Nx workspace
   */
  private async detectNxProjectPath(): Promise<string | undefined> {
    try {
      const nxConfig = await fs.readJSON(path.join(this.projectPath, 'nx.json'));
      // For now, return undefined - would need more sophisticated detection
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Detect Turbo project path if in a Turbo workspace
   */
  private async detectTurboProjectPath(): Promise<string | undefined> {
    try {
      const turboConfig = await fs.readJSON(path.join(this.projectPath, 'turbo.json'));
      // For now, return undefined - would need more sophisticated detection
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Interactive setup for complex workspaces
   */
  async interactiveSetup(): Promise<WorkspaceSetup> {
    const inquirer = await import('inquirer');
    let suggestedSetup = await this.analyzeWorkspace();

    console.log(chalk.blue('Forge Workspace Setup'));
    console.log(chalk.gray('Configuring deployment workflow for your project...'));
    console.log();

    // Show detected package manager
    console.log(chalk.green(`✓ Package Manager: ${this.packageManager}`));

    // Show detected monorepo (if any)
    if (suggestedSetup.monorepo) {
      console.log(chalk.green(`✓ Monorepo Type: ${suggestedSetup.monorepo.type}`));
    }

    // Offer template options
    const templates = WorkspaceManager.getWorkspaceTemplates();
    const templateNames = Object.keys(templates);
    
    if (templateNames.length > 0) {
      const { useTemplate } = await inquirer.default.prompt([{
        type: 'list',
        name: 'useTemplate',
        message: 'Choose a workflow template or customize:',
        choices: [
          { name: 'Auto-detect (recommended)', value: 'auto' },
          ...templateNames.map(name => ({ name: `${name} template`, value: name })),
          { name: 'Custom configuration', value: 'custom' }
        ]
      }]);

      if (useTemplate !== 'auto' && useTemplate !== 'custom') {
        const template = templates[useTemplate];
        if (template) {
          suggestedSetup = {
            ...suggestedSetup,
            ...template,
            preDeploySteps: template.preDeploySteps || [],
            buildSteps: template.buildSteps || [],
            postDeploySteps: template.postDeploySteps || []
          };
          console.log(chalk.green(`Using ${useTemplate} template`));
        }
      } else if (useTemplate === 'custom') {
        // Clear auto-detected steps for full customization
        suggestedSetup.preDeploySteps = [];
        suggestedSetup.buildSteps = [];
        suggestedSetup.postDeploySteps = [];
      }
    }

    // Continue with step-by-step configuration...

    // Allow user to customize pre-deploy steps
    if (suggestedSetup.preDeploySteps && suggestedSetup.preDeploySteps.length > 0) {
      console.log();
      console.log(chalk.blue('Detected Pre-Deploy Steps:'));
      
      for (const step of suggestedSetup.preDeploySteps) {
        const optional = step.optional ? chalk.gray('(optional)') : chalk.red('(required)');
        console.log(`  • ${step.name} ${optional}`);
        console.log(`    ${chalk.gray(step.command)}`);
      }

      const { confirmPreSteps } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirmPreSteps',
        message: 'Use these pre-deploy steps?',
        default: true
      }]);

      if (!confirmPreSteps) {
        suggestedSetup.preDeploySteps = await this.promptCustomSteps('pre-deploy');
      }
    } else {
      // Offer to add custom pre-deploy steps
      const { addPreSteps } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'addPreSteps',
        message: 'Add custom pre-deploy steps (database setup, code generation, etc.)?',
        default: false
      }]);

      if (addPreSteps) {
        suggestedSetup.preDeploySteps = await this.promptCustomSteps('pre-deploy');
      }
    }

    // Allow user to customize build steps
    if (suggestedSetup.buildSteps && suggestedSetup.buildSteps.length > 0) {
      console.log();
      console.log(chalk.blue('Detected Build Steps:'));
      
      for (const step of suggestedSetup.buildSteps) {
        const optional = step.optional ? chalk.gray('(optional)') : chalk.red('(required)');
        console.log(`  • ${step.name} ${optional}`);
        console.log(`    ${chalk.gray(step.command)}`);
      }

      const { confirmBuildSteps } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirmBuildSteps',
        message: 'Use these build steps?',
        default: true
      }]);

      if (!confirmBuildSteps) {
        suggestedSetup.buildSteps = await this.promptCustomSteps('build');
      }
    } else {
      // Offer to add custom build steps
      const { addBuildSteps } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'addBuildSteps',
        message: 'Add custom build steps?',
        default: false
      }]);

      if (addBuildSteps) {
        suggestedSetup.buildSteps = await this.promptCustomSteps('build');
      }
    }

    // Post-deploy steps
    if (suggestedSetup.postDeploySteps && suggestedSetup.postDeploySteps.length > 0) {
      console.log();
      console.log(chalk.blue('Detected Post-Deploy Steps:'));
      
      for (const step of suggestedSetup.postDeploySteps) {
        const optional = step.optional ? chalk.gray('(optional)') : chalk.red('(required)');
        console.log(`  • ${step.name} ${optional}`);
        console.log(`    ${chalk.gray(step.command)}`);
      }

      const { confirmPostSteps } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'confirmPostSteps',
        message: 'Use these post-deploy steps?',
        default: true
      }]);

      if (!confirmPostSteps) {
        suggestedSetup.postDeploySteps = await this.promptCustomSteps('post-deploy');
      }
    }

    // Advanced configuration options
    const { advancedConfig } = await inquirer.default.prompt([{
      type: 'confirm',
      name: 'advancedConfig',
      message: 'Configure advanced options (environment variables, timeouts, etc.)?',
      default: false
    }]);

    if (advancedConfig) {
      await this.configureAdvancedOptions(suggestedSetup);
    }

    return suggestedSetup;
  }

  /**
   * Prompt for custom build steps
   */
  private async promptCustomSteps(stepType: string = 'build'): Promise<BuildStep[]> {
    const inquirer = await import('inquirer');
    const steps: BuildStep[] = [];

    console.log(chalk.blue(`Adding custom ${stepType} steps...`));

    let addMore = true;
    while (addMore) {
      const stepData = await inquirer.default.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Step name:',
          validate: (input) => input.trim().length > 0 || 'Name is required'
        },
        {
          type: 'input',
          name: 'command',
          message: 'Command to run:',
          validate: (input) => input.trim().length > 0 || 'Command is required'
        },
        {
          type: 'confirm',
          name: 'optional',
          message: 'Is this step optional?',
          default: stepType === 'post-deploy' // Post-deploy steps are often optional
        },
        {
          type: 'number',
          name: 'timeout',
          message: 'Timeout in seconds:',
          default: stepType === 'build' ? 300 : 120
        }
      ]);

      steps.push({
        name: stepData.name,
        command: stepData.command,
        optional: stepData.optional,
        timeout: stepData.timeout
      });

      const { continueAdding } = await inquirer.default.prompt([{
        type: 'confirm',
        name: 'continueAdding',
        message: 'Add another step?',
        default: false
      }]);

      addMore = continueAdding;
    }

    return steps;
  }

  /**
   * Configure advanced options for workspace setup
   */
  private async configureAdvancedOptions(workspace: WorkspaceSetup): Promise<void> {
    const inquirer = await import('inquirer');

    console.log(chalk.blue('Advanced Configuration'));

    // Configure global environment variables
    const { addEnvVars } = await inquirer.default.prompt([{
      type: 'confirm',
      name: 'addEnvVars',
      message: 'Add global environment variables for all steps?',
      default: false
    }]);

    if (addEnvVars) {
      const globalEnv: Record<string, string> = {};
      let addMoreEnv = true;

      while (addMoreEnv) {
        const envData = await inquirer.default.prompt([
          {
            type: 'input',
            name: 'key',
            message: 'Environment variable name:',
            validate: (input) => input.trim().length > 0 || 'Variable name is required'
          },
          {
            type: 'input',
            name: 'value',
            message: 'Environment variable value:',
            default: ''
          }
        ]);

        globalEnv[envData.key] = envData.value;

        const { continueAddingEnv } = await inquirer.default.prompt([{
          type: 'confirm',
          name: 'continueAddingEnv',
          message: 'Add another environment variable?',
          default: false
        }]);

        addMoreEnv = continueAddingEnv;
      }

      // Apply environment variables to all steps
      const allSteps = [
        ...(workspace.preDeploySteps || []),
        ...(workspace.buildSteps || []),
        ...(workspace.postDeploySteps || [])
      ];

      for (const step of allSteps) {
        step.environment = { ...globalEnv, ...step.environment };
      }
    }

    // Configure parallel execution (future feature)
    const { enableParallel } = await inquirer.default.prompt([{
      type: 'confirm',
      name: 'enableParallel',
      message: 'Enable parallel execution for compatible steps? (experimental)',
      default: false
    }]);

    if (enableParallel) {
      console.log(chalk.yellow('Note: Parallel execution is experimental and may be added in future versions.'));
    }

    // Configure retry behavior
    const { configureRetries } = await inquirer.default.prompt([{
      type: 'confirm',
      name: 'configureRetries',
      message: 'Configure retry behavior for failed steps?',
      default: false
    }]);

    if (configureRetries) {
      const { defaultRetries } = await inquirer.default.prompt([{
        type: 'number',
        name: 'defaultRetries',
        message: 'Default number of retries for failed steps:',
        default: 1,
        validate: (input) => input >= 0 || 'Retries must be 0 or greater'
      }]);

      // Apply retry settings to non-optional steps
      const allSteps = [
        ...(workspace.preDeploySteps || []),
        ...(workspace.buildSteps || []),
        ...(workspace.postDeploySteps || [])
      ];

      for (const step of allSteps) {
        if (!step.optional && step.retries === undefined) {
          step.retries = defaultRetries;
        }
      }
    }
  }

  /**
   * Optimize workspace configuration for specific frameworks
   */
  private async optimizeForFramework(workspace: WorkspaceSetup, packageJson: any): Promise<void> {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const scripts = packageJson.scripts || {};

    // Next.js optimizations
    if (dependencies['next']) {
      // Add build caching for Next.js
      if (workspace.buildSteps && workspace.buildSteps.length > 0) {
        workspace.buildSteps[0].environment = {
          ...workspace.buildSteps[0].environment,
          'NEXT_TELEMETRY_DISABLED': '1'
        };
      }

      // Add post-install for Next.js if using custom server
      if (scripts['dev:server'] || scripts['start:server']) {
        workspace.postInstallSteps = workspace.postInstallSteps || [];
        workspace.postInstallSteps.push({
          name: 'Next.js Setup',
          command: 'npx next telemetry disable',
          optional: true,
          timeout: 30
        });
      }
    }

    // Vite optimizations
    if (dependencies['vite']) {
      if (workspace.buildSteps && workspace.buildSteps.length > 0) {
        workspace.buildSteps[0].environment = {
          ...workspace.buildSteps[0].environment,
          'VITE_NODE_ENV': 'production'
        };
      }
    }

    // React Native optimizations (if detected)
    if (dependencies['react-native']) {
      console.log(chalk.yellow('Warning: React Native project detected. This CLI is optimized for web applications.'));
    }

    // Add monorepo-specific optimizations
    if (workspace.monorepo) {
      await this.optimizeForMonorepo(workspace, packageJson);
    }

    // Docker optimizations (if Dockerfile exists)
    if (await fs.pathExists(path.join(this.projectPath, 'Dockerfile'))) {
      workspace.preDeploySteps = workspace.preDeploySteps || [];
      workspace.preDeploySteps.push({
        name: 'Docker Build',
        command: 'docker build -t forge-deployment .',
        optional: true,
        timeout: 600
      });
    }
  }

  /**
   * Add monorepo-specific optimizations
   */
  private async optimizeForMonorepo(workspace: WorkspaceSetup, packageJson: any): Promise<void> {
    if (!workspace.monorepo) return;

    const scripts = packageJson.scripts || {};

    switch (workspace.monorepo.type) {
      case 'nx':
        // Add Nx cache optimization
        if (scripts['nx:reset']) {
          workspace.preDeploySteps?.unshift({
            name: 'Nx Cache Reset',
            command: `${this.packageManager} run nx:reset`,
            optional: true,
            timeout: 30
          });
        }
        break;

      case 'turbo':
        // Add Turbo cache configuration
        if (workspace.buildSteps && workspace.buildSteps.length > 0) {
          workspace.buildSteps[0].environment = {
            ...workspace.buildSteps[0].environment,
            'TURBO_TOKEN': process.env.TURBO_TOKEN || '',
            'TURBO_TEAM': process.env.TURBO_TEAM || ''
          };
        }
        break;

      case 'lerna':
        // Add Lerna bootstrap if needed
        if (scripts.bootstrap) {
          workspace.preDeploySteps?.unshift({
            name: 'Lerna Bootstrap',
            command: `${this.packageManager} run bootstrap`,
            optional: false,
            timeout: 300
          });
        }
        break;
    }
  }
}
