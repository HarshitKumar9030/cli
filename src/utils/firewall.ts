import chalk from 'chalk';
import { execSync } from 'child_process';

// Cloud provider detection and firewall utilities
export interface CloudProvider {
  name: string;
  detected: boolean;
  firewallInstructions: string[];
}

export async function detectCloudProvider(): Promise<CloudProvider> {
  try {
    // Check for GCP metadata
    try {
      execSync('curl -s -m 3 http://metadata.google.internal/computeMetadata/v1/ -H "Metadata-Flavor: Google"', { stdio: 'pipe' });
      return {
        name: 'Google Cloud Platform (GCP)',
        detected: true,
        firewallInstructions: [
          'Your server is running on Google Cloud Platform.',
          'You need to enable HTTP/HTTPS traffic in GCP firewall rules.',
          '',
          '🔧 Option 1: Using GCP Console (Recommended)',
          '  1. Go to: https://console.cloud.google.com/compute/instances',
          '  2. Click on your instance name',
          '  3. Click "Edit" at the top',
          '  4. Under "Firewall", check both:',
          '     ☑️ Allow HTTP traffic',
          '     ☑️ Allow HTTPS traffic',
          '  5. Click "Save"',
          '',
          '🔧 Option 2: Using gcloud CLI',
          '  Run these commands:',
          '  gcloud compute instances add-tags YOUR-INSTANCE-NAME --tags=http-server,https-server',
          '  gcloud compute firewall-rules create allow-http --allow tcp:80 --source-ranges 0.0.0.0/0 --target-tags http-server',
          '  gcloud compute firewall-rules create allow-https --allow tcp:443 --source-ranges 0.0.0.0/0 --target-tags https-server',
          '',
          '⚠️  After enabling firewall rules, wait 2-3 minutes for changes to take effect.'
        ]
      };
    } catch {}

    // Check for DigitalOcean
    try {
      execSync('curl -s -m 3 http://169.254.169.254/metadata/v1/', { stdio: 'pipe' });
      return {
        name: 'DigitalOcean',
        detected: true,
        firewallInstructions: [
          'Your server is running on DigitalOcean.',
          'You need to configure Cloud Firewalls or ufw to allow HTTP/HTTPS traffic.',
          '',
          '🔧 Option 1: Using DigitalOcean Control Panel (Recommended)',
          '  1. Go to: https://cloud.digitalocean.com/networking/firewalls',
          '  2. Create or edit your firewall',
          '  3. Add inbound rules for:',
          '     • HTTP (port 80) from All IPv4 and All IPv6',
          '     • HTTPS (port 443) from All IPv4 and All IPv6',
          '  4. Apply firewall to your droplet',
          '',
          '🔧 Option 2: Using UFW (Ubuntu Firewall)',
          '  sudo ufw allow 80/tcp',
          '  sudo ufw allow 443/tcp',
          '  sudo ufw enable',
          '',
          '🔧 Option 3: Using iptables',
          '  sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT',
          '  sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT',
          '  sudo iptables-save > /etc/iptables/rules.v4'
        ]
      };
    } catch {}

    // Check for AWS metadata (after DigitalOcean check)
    try {
      execSync('curl -s -m 3 http://169.254.169.254/latest/meta-data/', { stdio: 'pipe' });
      return {
        name: 'Amazon Web Services (AWS)',
        detected: true,
        firewallInstructions: [
          'Your server is running on Amazon Web Services (AWS).',
          'You need to configure Security Groups to allow HTTP/HTTPS traffic.',
          '',
          '🔧 Using AWS Console:',
          '  1. Go to: https://console.aws.amazon.com/ec2/v2/home#SecurityGroups',
          '  2. Find your instance\'s security group',
          '  3. Click "Edit inbound rules"',
          '  4. Add these rules:',
          '     • HTTP (port 80) from 0.0.0.0/0',
          '     • HTTPS (port 443) from 0.0.0.0/0',
          '  5. Click "Save rules"',
          '',
          '🔧 Using AWS CLI:',
          '  aws ec2 authorize-security-group-ingress --group-id sg-XXXXXXXXX --protocol tcp --port 80 --cidr 0.0.0.0/0',
          '  aws ec2 authorize-security-group-ingress --group-id sg-XXXXXXXXX --protocol tcp --port 443 --cidr 0.0.0.0/0'
        ]
      };
    } catch {}

  } catch (error) {
    // Ignore detection errors
  }

  return {
    name: 'Unknown/On-Premises',
    detected: false,
    firewallInstructions: [
      'Could not detect cloud provider. Please ensure your firewall allows HTTP/HTTPS traffic.',
      '',
      '🔧 Common firewall commands:',
      '  • UFW: sudo ufw allow 80/tcp && sudo ufw allow 443/tcp',
      '  • Firewalld: sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload',
      '  • Iptables: sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT && sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT',
      '',
      '⚠️  Make sure your router/network also allows these ports if running locally.'
    ]
  };
}

export async function checkPortAccessibility(port: number): Promise<boolean> {
  try {
    // First, check if the port is bound locally (service is running)
    const isLocallyBound = await checkLocalPortBinding(port);
    
    // If port 80 is bound and nginx is running, assume firewall is likely configured
    if (port === 80 && isLocallyBound) {
      try {
        execSync('systemctl is-active nginx', { stdio: 'pipe' });
        console.log(chalk.gray(`Port ${port}: Service detected, assuming firewall is configured`));
        return true;
      } catch {
        // nginx not running, continue with external check
      }
    }
    
    // Get public IP for external connectivity test
    let publicIP: string;
    try {
      publicIP = execSync('curl -s -m 5 ifconfig.me || curl -s -m 5 ipinfo.io/ip || curl -s -m 5 ipecho.net/plain', { encoding: 'utf8' }).trim();
    } catch {
      console.log(chalk.yellow(`⚠️  Could not determine public IP for port ${port} test`));
      // If we can't get public IP but port is bound locally, assume it's accessible
      return isLocallyBound;
    }

    // Test if port is accessible from external networks
    // Use a more reliable method that doesn't require self-connection
    try {
      // Check if port is listening
      if (!isLocallyBound) {
        console.log(chalk.gray(`Port ${port}: Not bound locally`));
        return false;
      }
      
      // For port 80, try a simple HTTP request to verify accessibility
      if (port === 80) {
        try {
          const testResult = execSync(`curl -s -m 10 -I http://${publicIP}/ || curl -s -m 10 -I http://localhost/`, { encoding: 'utf8' });
          if (testResult.includes('HTTP/') || testResult.includes('nginx')) {
            console.log(chalk.gray(`Port ${port}: HTTP service responding`));
            return true;
          }
        } catch {
          // HTTP test failed, fall back to socket test
        }
      }
      
      // Fallback: try socket connection (may fail on some cloud providers)
      try {
        execSync(`timeout 10 bash -c "echo >/dev/tcp/${publicIP}/${port}"`, { stdio: 'pipe' });
        return true;
      } catch {
        // Socket test failed, but if service is running locally, assume firewall issues
        console.log(chalk.gray(`Port ${port}: External connection test failed (may indicate firewall block)`));
        return false;
      }
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

// Helper function to check if a port is bound locally
async function checkLocalPortBinding(port: number): Promise<boolean> {
  try {
    const result = execSync(`netstat -tlnp 2>/dev/null | grep ":${port} " || ss -tlnp 2>/dev/null | grep ":${port} "`, { encoding: 'utf8', stdio: 'pipe' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function performFirewallPreflightCheck(): Promise<boolean> {
  console.log(chalk.cyan('🔍 Checking firewall configuration for SSL setup...'));
  
  const cloudProvider = await detectCloudProvider();
  console.log(chalk.gray(`Detected environment: ${cloudProvider.name}`));
  
  // Check if ports 80 and 443 are accessible
  console.log(chalk.gray('Testing port accessibility...'));
  
  const port80Accessible = await checkPortAccessibility(80);
  const port443Accessible = await checkPortAccessibility(443);
  
  // If port 80 is working (which indicates firewall is likely configured), 
  // don't block SSL setup just because port 443 test fails
  if (port80Accessible) {
    if (port443Accessible) {
      console.log(chalk.green('✅ Ports 80 and 443 are accessible from the internet'));
    } else {
      console.log(chalk.yellow('⚠️  Port 80 is accessible, port 443 test inconclusive'));
      console.log(chalk.gray('SSL certificates can be issued successfully.'));
    }
    return true;
  }
  
  console.log(chalk.red('❌ Firewall Issue Detected'));
  console.log(chalk.red('Port 80 is not accessible from the internet.'));
  console.log(chalk.red('This will prevent Let\'s Encrypt from issuing SSL certificates.'));
  console.log();
  
  if (cloudProvider.detected) {
    console.log(chalk.yellow.bold(`🛠️  ${cloudProvider.name} Firewall Setup Required:`));
    cloudProvider.firewallInstructions.forEach(instruction => {
      if (instruction.startsWith('🔧') || instruction.startsWith('⚠️')) {
        console.log(chalk.blue(instruction));
      } else if (instruction.trim() === '') {
        console.log();
      } else {
        console.log(chalk.gray(`  ${instruction}`));
      }
    });
  } else {
    console.log(chalk.yellow.bold('🛠️  Firewall Setup Required:'));
    cloudProvider.firewallInstructions.forEach(instruction => {
      if (instruction.startsWith('🔧') || instruction.startsWith('⚠️')) {
        console.log(chalk.blue(instruction));
      } else if (instruction.trim() === '') {
        console.log();
      } else {
        console.log(chalk.gray(`  ${instruction}`));
      }
    });
  }
  
  console.log();
  console.log(chalk.yellow('After configuring your firewall:'));
  console.log(chalk.gray('  1. Wait 2-3 minutes for changes to take effect'));
  console.log(chalk.gray('  2. Run: forge infra --ssl'));
  console.log(chalk.gray('  3. Or continue with: forge deploy <repo-url>'));
  
  return false;
}
