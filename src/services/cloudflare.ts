import chalk from 'chalk';

/**
 * Cloudflare service for CLI - now delegates to API
 * 
 * Note: For security reasons, Cloudflare API tokens are managed server-side.
 * This service provides a compatibility layer but all DNS operations are
 * handled via the Forge API endpoints.
 */
export class CloudflareService {
  /**
   * @deprecated Use ForgeApiService.createSubdomain() instead
   * This method is maintained for compatibility but delegates to the API
   */
  static async updateSubdomainRecord(subdomain: string, publicIP: string): Promise<void> {
    console.log(chalk.yellow('Direct Cloudflare API access has been moved to server-side for security.'));
    console.log(chalk.gray('Use the Forge API endpoints for DNS management.'));
    
    throw new Error('Direct Cloudflare access is no longer supported. Use ForgeApiService.createSubdomain() instead.');
  }

  /**
   * @deprecated Cloudflare credentials are now managed server-side
   */
  static async loadFromCredentials(): Promise<CloudflareService | null> {
    console.log(chalk.yellow('Cloudflare credentials are now managed server-side for security.'));
    return null;
  }
}

export default CloudflareService;
