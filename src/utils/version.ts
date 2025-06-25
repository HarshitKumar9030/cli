import semver from 'semver';
import chalk from 'chalk';

const CURRENT_VERSION = '1.0.0';
const MIN_NODE_VERSION = '16.0.0';

export async function checkVersion(): Promise<void> {
  // Check Node.js version
  const nodeVersion = process.version;
  if (!semver.gte(nodeVersion, MIN_NODE_VERSION)) {
    console.error(chalk.red(`Error: Node.js ${MIN_NODE_VERSION} or higher is required. You are using ${nodeVersion}`));
    process.exit(1);
  }
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
