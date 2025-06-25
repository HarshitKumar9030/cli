import os from 'os';
import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * Get the system's public IP address for subdomain routing
 */
export async function getPublicIP(): Promise<string> {
  try {
    console.log(chalk.gray('Detecting public IP address...'));
    
    // Try multiple services for reliability
    const services = [
      'https://api.ipify.org',
      'https://ipinfo.io/ip',
      'https://icanhazip.com',
      'https://checkip.amazonaws.com'
    ];
    
    for (const service of services) {
      try {
        const response = await fetch(service, { signal: AbortSignal.timeout(5000) });
        const ip = (await response.text()).trim();
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          console.log(chalk.gray(`Public IP detected: ${ip}`));
          return ip;
        }
      } catch {
        continue;
      }
    }
    
    throw new Error('All public IP services failed');
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not detect public IP, falling back to local IP'));
    return getSystemIP();
  }
}

/**
 * Get the system's local IP address (fallback)
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
 * Check if required system privileges are available and warn user
 */
export function checkSystemPrivileges(): boolean {
  const elevated = isElevated();
  
  if (!elevated) {
    console.log(chalk.yellow('⚠️  System Infrastructure Setup Warning:'));
    
    if (isWindows()) {
      console.log(chalk.gray('  For full infrastructure setup, run PowerShell as Administrator:'));
      console.log(chalk.cyan('  Right-click PowerShell → "Run as administrator"'));
      console.log(chalk.cyan('  Then run: npm install -g forge-deploy-cli'));
    } else {
      console.log(chalk.gray('  For full infrastructure setup, run with sudo:'));
      console.log(chalk.cyan('  sudo npm install -g forge-deploy-cli'));
      console.log(chalk.cyan('  Or: sudo forge infra --all'));
    }
    
    console.log(chalk.gray('  Without elevated privileges, some features may be limited.'));
    console.log();
  }
  
  return elevated;
}

/**
 * Ensure command is run with proper privileges or provide guidance
 */
export function requireElevatedPrivileges(command: string): void {
  if (!isElevated()) {
    console.log(chalk.red(`❌ ${command} requires elevated privileges`));
    console.log();
    
    if (isWindows()) {
      console.log(chalk.blue('Windows: Run as Administrator'));
      console.log(chalk.gray('1. Right-click Command Prompt or PowerShell'));
      console.log(chalk.gray('2. Select "Run as administrator"'));
      console.log(chalk.cyan(`3. Run: forge ${command}`));
    } else {
      console.log(chalk.blue('Linux/macOS: Run with sudo'));
      console.log(chalk.cyan(`sudo forge ${command}`));
    }
    
    console.log();
    process.exit(1);
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

/**
 * Validate if an IP address is a valid public IP
 */
export function validatePublicIP(ip: string): { isValid: boolean; warning?: string } {
  // Check basic IP format
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    return { isValid: false, warning: 'Invalid IP format' };
  }

  const parts = ip.split('.').map(Number);
  
  // Check for private IP ranges
  if (
    // 10.0.0.0/8
    parts[0] === 10 ||
    // 172.16.0.0/12
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    // 192.168.0.0/16
    (parts[0] === 192 && parts[1] === 168) ||
    // 127.0.0.0/8 (localhost)
    parts[0] === 127 ||
    // 169.254.0.0/16 (link-local)
    (parts[0] === 169 && parts[1] === 254) ||
    // 224.0.0.0/4 (multicast)
    parts[0] >= 224
  ) {
    return { isValid: false, warning: 'Private/internal IP detected - this may not work for public access' };
  }

  // Check for documentation/test IP ranges (RFC 5737)
  if (
    // 192.0.2.0/24 (TEST-NET-1)
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) ||
    // 198.51.100.0/24 (TEST-NET-2)
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    // 203.0.113.0/24 (TEST-NET-3)
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
  ) {
    return { isValid: false, warning: 'Documentation/test IP detected - this is not a real public IP' };
  }

  return { isValid: true };
}

/**
 * Check if DNS is properly configured for a domain
 */
export async function checkDNSConfiguration(domain: string, expectedIP: string): Promise<{ configured: boolean; currentIP?: string; error?: string }> {
  try {
    const dns = await import('dns').then(m => m.promises);
    
    try {
      const addresses = await dns.resolve4(domain);
      const currentIP = addresses[0];
      
      if (currentIP === expectedIP) {
        return { configured: true, currentIP };
      } else {
        return { configured: false, currentIP, error: `DNS points to ${currentIP} but expected ${expectedIP}` };
      }
    } catch (dnsError: any) {
      if (dnsError.code === 'ENOTFOUND') {
        return { configured: false, error: 'Domain not found in DNS' };
      } else {
        return { configured: false, error: `DNS lookup failed: ${dnsError.message}` };
      }
    }
  } catch (error: any) {
    return { configured: false, error: `DNS check failed: ${error.message}` };
  }
}
