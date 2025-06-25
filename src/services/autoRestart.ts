import fs from 'fs-extra';
import path from 'path';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
import { isWindows } from '../utils/system';

export interface AutoRestartConfig {
  enabled: boolean;
  serviceName: string;
  executablePath: string;
  workingDirectory: string;
  logPath: string;
  restartDelay: number;
}

export class AutoRestartService {
  private static readonly CONFIG_FILE = 'forge-autorestart.json';
  private static readonly SERVICE_NAME = 'ForgeCliService';
  private static readonly LOG_DIR = path.join(process.cwd(), 'logs');

  /**
   * Setup auto-restart for the Forge CLI
   */
  static async setupAutoRestart(): Promise<void> {
    try {
      console.log(chalk.cyan('Setting up auto-restart service...'));

      const config = await this.createConfig();
      
      if (isWindows()) {
        await this.setupWindowsService(config);
      } else {
        await this.setupUnixService(config);
      }

      await this.saveConfig(config);
      console.log(chalk.green('Auto-restart service configured successfully'));
      
    } catch (error) {
      console.error(chalk.red(`Failed to setup auto-restart: ${error}`));
      throw error;
    }
  }

  /**
   * Remove auto-restart service
   */
  static async removeAutoRestart(): Promise<void> {
    try {
      console.log(chalk.cyan('Removing auto-restart service...'));

      if (isWindows()) {
        await this.removeWindowsService();
      } else {
        await this.removeUnixService();
      }

      await this.removeConfig();
      console.log(chalk.green('Auto-restart service removed successfully'));
      
    } catch (error) {
      console.error(chalk.red(`Failed to remove auto-restart: ${error}`));
      throw error;
    }
  }

  /**
   * Check if auto-restart is enabled
   */
  static async isAutoRestartEnabled(): Promise<boolean> {
    try {
      const config = await this.loadConfig();
      return config?.enabled || false;
    } catch {
      return false;
    }
  }

  /**
   * Start the auto-restart service
   */
  static async startAutoRestart(): Promise<void> {
    try {
      if (isWindows()) {
        execSync(`sc start ${this.SERVICE_NAME}`, { stdio: 'pipe' });
      } else {
        execSync(`systemctl start ${this.SERVICE_NAME.toLowerCase()}`, { stdio: 'pipe' });
      }
      console.log(chalk.green('Auto-restart service started'));
    } catch (error) {
      console.error(chalk.red(`Failed to start auto-restart service: ${error}`));
    }
  }

  /**
   * Stop the auto-restart service
   */
  static async stopAutoRestart(): Promise<void> {
    try {
      if (isWindows()) {
        execSync(`sc stop ${this.SERVICE_NAME}`, { stdio: 'pipe' });
      } else {
        execSync(`systemctl stop ${this.SERVICE_NAME.toLowerCase()}`, { stdio: 'pipe' });
      }
      console.log(chalk.green('Auto-restart service stopped'));
    } catch (error) {
      console.error(chalk.red(`Failed to stop auto-restart service: ${error}`));
    }
  }

  /**
   * Create configuration for auto-restart
   */
  private static async createConfig(): Promise<AutoRestartConfig> {
    const executablePath = process.execPath;
    const workingDirectory = process.cwd();
    
    await fs.ensureDir(this.LOG_DIR);

    return {
      enabled: true,
      serviceName: this.SERVICE_NAME,
      executablePath,
      workingDirectory,
      logPath: path.join(this.LOG_DIR, 'forge-service.log'),
      restartDelay: 5000
    };
  }

  /**
   * Setup Windows service
   */
  private static async setupWindowsService(config: AutoRestartConfig): Promise<void> {
    // Create a batch file to start the service
    const batchContent = `@echo off
cd /d "${config.workingDirectory}"
"${config.executablePath}" --service >> "${config.logPath}" 2>&1
`;

    const batchPath = path.join(config.workingDirectory, 'forge-service.bat');
    await fs.writeFile(batchPath, batchContent);

    // Create the Windows service using sc command
    const serviceCommand = `sc create ${config.serviceName} binPath= "${batchPath}" start= auto DisplayName= "Forge CLI Auto-Restart Service"`;
    
    try {
      execSync(serviceCommand, { stdio: 'pipe' });
      console.log(chalk.green(`Windows service '${config.serviceName}' created`));
    } catch (error) {
      console.warn(chalk.yellow('Note: Creating Windows service requires administrator privileges'));
      console.log(chalk.gray('Run as administrator to enable auto-restart on system boot'));
    }
  }

  /**
   * Setup Unix/Linux service (systemd)
   */
  private static async setupUnixService(config: AutoRestartConfig): Promise<void> {
    const serviceContent = `[Unit]
Description=Forge CLI Auto-Restart Service
After=network.target

[Service]
Type=simple
User=${process.env.USER || 'forge'}
WorkingDirectory=${config.workingDirectory}
ExecStart=${config.executablePath} --service
Restart=always
RestartSec=5
StandardOutput=append:${config.logPath}
StandardError=append:${config.logPath}

[Install]
WantedBy=multi-user.target
`;

    const servicePath = `/etc/systemd/system/${config.serviceName.toLowerCase()}.service`;
    
    try {
      await fs.writeFile(servicePath, serviceContent);
      execSync('systemctl daemon-reload', { stdio: 'pipe' });
      execSync(`systemctl enable ${config.serviceName.toLowerCase()}`, { stdio: 'pipe' });
      console.log(chalk.green(`Systemd service '${config.serviceName}' created`));
    } catch (error) {
      console.warn(chalk.yellow('Note: Creating systemd service requires root privileges'));
      console.log(chalk.gray('Run with sudo to enable auto-restart on system boot'));
    }
  }

  /**
   * Remove Windows service
   */
  private static async removeWindowsService(): Promise<void> {
    try {
      execSync(`sc delete ${this.SERVICE_NAME}`, { stdio: 'pipe' });
      
      // Clean up batch file
      const batchPath = path.join(process.cwd(), 'forge-service.bat');
      if (await fs.pathExists(batchPath)) {
        await fs.remove(batchPath);
      }
    } catch (error) {
      console.warn(chalk.yellow(`Service removal failed: ${error}`));
    }
  }

  /**
   * Remove Unix service
   */
  private static async removeUnixService(): Promise<void> {
    try {
      const serviceName = this.SERVICE_NAME.toLowerCase();
      execSync(`systemctl stop ${serviceName}`, { stdio: 'pipe' });
      execSync(`systemctl disable ${serviceName}`, { stdio: 'pipe' });
      
      const servicePath = `/etc/systemd/system/${serviceName}.service`;
      if (await fs.pathExists(servicePath)) {
        await fs.remove(servicePath);
      }
      
      execSync('systemctl daemon-reload', { stdio: 'pipe' });
    } catch (error) {
      console.warn(chalk.yellow(`Service removal failed: ${error}`));
    }
  }

  /**
   * Save configuration
   */
  private static async saveConfig(config: AutoRestartConfig): Promise<void> {
    const configPath = path.join(process.cwd(), this.CONFIG_FILE);
    await fs.writeJSON(configPath, config, { spaces: 2 });
  }

  /**
   * Load configuration
   */
  private static async loadConfig(): Promise<AutoRestartConfig | null> {
    try {
      const configPath = path.join(process.cwd(), this.CONFIG_FILE);
      return await fs.readJSON(configPath);
    } catch {
      return null;
    }
  }

  /**
   * Remove configuration
   */
  private static async removeConfig(): Promise<void> {
    try {
      const configPath = path.join(process.cwd(), this.CONFIG_FILE);
      if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Start the service daemon
   */
  static async startServiceDaemon(): Promise<void> {
    console.log(chalk.blue('Starting Forge CLI service daemon...'));
    
    const config = await this.loadConfig();
    if (!config) {
      throw new Error('Auto-restart not configured');
    }

    // Start the main process monitoring loop
    this.startMonitoringLoop(config);
  }

  /**
   * Monitoring loop for the service
   */
  private static startMonitoringLoop(config: AutoRestartConfig): void {
    const startTime = Date.now();
    console.log(chalk.green(`Forge CLI service started at ${new Date().toISOString()}`));

    // Monitor for system events and restart if needed
    process.on('SIGTERM', () => {
      console.log(chalk.yellow('Service received SIGTERM, shutting down gracefully...'));
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log(chalk.yellow('Service received SIGINT, shutting down gracefully...'));
      process.exit(0);
    });

    // Keep the process alive
    setInterval(() => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      console.log(chalk.gray(`Service uptime: ${uptime} seconds`));
    }, 60000); // Log every minute
  }
}
