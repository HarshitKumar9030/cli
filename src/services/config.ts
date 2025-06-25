import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { ForgeConfig } from '../types';

const CONFIG_DIR = path.join(os.homedir(), '.forge');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PROJECT_CONFIG_FILE = 'forge.config.json';

export class ConfigService {
  
  async ensureConfigDir(): Promise<void> {
    await fs.ensureDir(CONFIG_DIR);
  }

  async saveGlobalConfig(config: Partial<ForgeConfig>): Promise<void> {
    await this.ensureConfigDir();
    const existingConfig = await this.loadGlobalConfig();
    const updatedConfig = { ...existingConfig, ...config };
    await fs.writeJSON(CONFIG_FILE, updatedConfig, { spaces: 2 });
  }

  async loadGlobalConfig(): Promise<ForgeConfig> {
    try {
      await this.ensureConfigDir();
      const config = await fs.readJSON(CONFIG_FILE);
      return config;
    } catch (error) {
      return {
        apiUrl: 'https://api.agfe.tech'
      };
    }
  }

  async saveProjectConfig(config: Partial<ForgeConfig>): Promise<void> {
    const existingConfig = await this.loadProjectConfig();
    const updatedConfig = { ...existingConfig, ...config };
    await fs.writeJSON(PROJECT_CONFIG_FILE, updatedConfig, { spaces: 2 });
  }

  async loadProjectConfig(): Promise<ForgeConfig> {
    try {
      const config = await fs.readJSON(PROJECT_CONFIG_FILE);
      return config;
    } catch (error) {
      return {
        apiUrl: 'https://api.agfe.tech'
      };
    }
  }

  async getConfig(): Promise<ForgeConfig> {
    const globalConfig = await this.loadGlobalConfig();
    const projectConfig = await this.loadProjectConfig();
    return { ...globalConfig, ...projectConfig };
  }

  async setConfigValue(key: string, value: string, global: boolean = false): Promise<void> {
    const config = global ? await this.loadGlobalConfig() : await this.loadProjectConfig();
    
    // Handle nested keys like "env.NODE_ENV"
    const keys = key.split('.');
    let current: any = config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    
    current[keys[keys.length - 1]] = value;
    
    if (global) {
      await this.saveGlobalConfig(config);
    } else {
      await this.saveProjectConfig(config);
    }
  }

  async getConfigValue(key: string): Promise<any> {
    const config = await this.getConfig();
    const keys = key.split('.');
    let current: any = config;
    
    for (const k of keys) {
      if (current && typeof current === 'object' && k in current) {
        current = current[k];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  async removeConfigValue(key: string, global: boolean = false): Promise<void> {
    const config = global ? await this.loadGlobalConfig() : await this.loadProjectConfig();
    const keys = key.split('.');
    let current: any = config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        return; // Key doesn't exist
      }
      current = current[keys[i]];
    }
    
    delete current[keys[keys.length - 1]];
    
    if (global) {
      await this.saveGlobalConfig(config);
    } else {
      await this.saveProjectConfig(config);
    }
  }

  async clearConfig(global: boolean = false): Promise<void> {
    if (global) {
      await fs.remove(CONFIG_FILE);
    } else {
      await fs.remove(PROJECT_CONFIG_FILE);
    }
  }
}
