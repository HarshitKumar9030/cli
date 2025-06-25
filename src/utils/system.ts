import os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Get the system's local IP address for subdomain routing
 */
export function getSystemIP(): string {
  try {
    const interfaces = os.networkInterfaces();
    
    // Priority order: ethernet, wifi, then others
    const priorityOrder = ['Ethernet', 'Wi-Fi', 'WiFi', 'wlan0', 'eth0'];
    
    for (const name of priorityOrder) {
      const iface = interfaces[name];
      if (iface) {
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            return alias.address;
          }
        }
      }
    }
    
    // Fallback: find any non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            return alias.address;
          }
        }
      }
    }
    
    // Final fallback
    return '127.0.0.1';
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not detect system IP, using localhost'));
    return '127.0.0.1';
  }
}

/**
 * Get external IP address if needed
 */
export async function getExternalIP(): Promise<string> {
  try {
    // Try multiple services for reliability
    const services = [
      'https://api.ipify.org',
      'https://ipinfo.io/ip',
      'https://icanhazip.com'
    ];
    
    for (const service of services) {
      try {
        const response = await fetch(service, { signal: AbortSignal.timeout(5000) });
        const ip = (await response.text()).trim();
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          return ip;
        }
      } catch {
        continue;
      }
    }
    
    throw new Error('All services failed');
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not detect external IP'));
    return getSystemIP();
  }
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return os.platform() === 'win32';
}

/**
 * Check if running as administrator/root
 */
export function isElevated(): boolean {
  try {
    if (isWindows()) {
      // Check if running as administrator on Windows
      execSync('net session', { stdio: 'pipe' });
      return true;
    } else {
      // Check if running as root on Unix-like systems
      return !!(process.getuid && process.getuid() === 0);
    }
  } catch {
    return false;
  }
}

/**
 * Get system information for debugging
 */
export function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    localIP: getSystemIP(),
    isElevated: isElevated(),
    nodeVersion: process.version,
    memory: {
      total: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      free: Math.round(os.freemem() / 1024 / 1024 / 1024)
    }
  };
}
