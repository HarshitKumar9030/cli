# Forge CLI

A powerful command-line interface for deploying and managing applications locally with automatic subdomain routing, process management, and infrastructure setup.

## Installation

### Standard Installation
```bash
npm install -g forge-deploy-cli
```

### Recommended: Installation with System Privileges

For full infrastructure setup (nginx, system services), install with elevated privileges:

#### Windows
```powershell
# Run PowerShell as Administrator
npm install -g forge-deploy-cli
```

#### Linux/macOS
```bash
# Install with sudo for system-wide infrastructure setup
sudo npm install -g forge-deploy-cli
```

## Quick Start

### 1. Setup Infrastructure (Recommended)
```bash
# Setup all infrastructure components with elevated privileges
sudo forge infra --all          # Linux/macOS
# OR (Windows as Administrator)
forge infra --all

# Or setup components individually
forge infra --pm2               # Process manager
forge infra --nginx             # Reverse proxy (requires admin/sudo)
forge infra --nodejs            # Node.js dependencies
forge infra --python            # Python dependencies
forge infra --service           # Auto-restart service
```

### 2. Authenticate and Deploy
```bash
# Authenticate
forge login

# Deploy from GitHub
forge deploy https://github.com/username/repository

# Deploy from local directory
forge deploy ./my-app

# Check deployment status
forge status

# View logs
forge logs

# Stop deployment
forge stop
```

## Features

- ✅ **Local Deployments** - Deploy apps locally with auto-generated subdomains
- ✅ **Process Management** - PM2 integration for robust process handling
- ✅ **Reverse Proxy** - Nginx configuration for subdomain routing
- ✅ **Auto-Restart** - System service for deployment persistence
- ✅ **Framework Detection** - Supports Next.js, React, Vue, Node.js, Python, PHP, and more
- ✅ **Git Integration** - Clone and deploy from repositories
- ✅ **Build Automation** - Automatic dependency installation and building

## Commands

### Authentication
```bash
forge login          # Authenticate with Forge platform
forge signup         # Create new account
```

### Deployment
```bash
forge deploy [source]           # Deploy app from repo or directory
forge deploy --subdomain name  # Custom subdomain
forge deploy --skip-build      # Skip build step
forge deploy --force           # Force deployment on errors
```

### Management
```bash
forge status                    # Check all deployments
forge status --all              # Show all deployments
forge logs [deployment-id]     # View deployment logs
forge stop [deployment-id]     # Stop deployment
```

### Infrastructure (Requires Admin/Sudo)
```bash
forge infra --all              # Setup all infrastructure
forge infra --pm2              # Setup PM2 process manager
forge infra --nginx            # Setup Nginx reverse proxy (requires sudo)
forge infra --nodejs           # Setup Node.js dependencies (serve, etc.)
forge infra --python           # Setup Python dependencies (uvicorn, gunicorn)
forge infra --service          # Setup auto-restart service
```

### Service Management
```bash
forge service status           # Check service status
forge service start            # Start service
forge service stop             # Stop service
forge service enable           # Enable auto-start
```

## Infrastructure Setup

The CLI automatically sets up:

1. **PM2** - Process manager for Node.js applications
2. **Nginx** - Reverse proxy for subdomain routing
3. **System Service** - Auto-restart on system reboot

### Manual Setup (if needed)

#### Windows
- Install nginx: Download from nginx.org, extract to `C:\nginx`
- PM2 Windows service: `pm2-windows-startup install`

#### Linux
```bash
sudo apt-get install nginx      # Install nginx
sudo systemctl enable nginx     # Enable nginx
forge infra --all              # Setup Forge infrastructure
```

## Configuration

### DNS Setup
Point your domain to your server IP:
```
*.forgecli.tech → YOUR_SERVER_IP
```

### Firewall
Open required ports:
```bash
# Windows
netsh advfirewall firewall add rule name="HTTP" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="HTTPS" dir=in action=allow protocol=TCP localport=443

# Linux
sudo ufw allow 80
sudo ufw allow 443
```

## Supported Frameworks

- **Frontend**: React, Vue, Angular, Next.js, Nuxt, Svelte
- **Backend**: Node.js (Express, Fastify, NestJS), Python (Django, Flask, FastAPI), PHP (Laravel, Symfony)
- **Static**: HTML/CSS/JS sites

## Examples

### Deploy Next.js App
```bash
forge deploy https://github.com/vercel/next.js/tree/canary/examples/hello-world
```

### Deploy React App
```bash
forge deploy https://github.com/facebook/create-react-app
```

### Deploy from Local Directory
```bash
cd my-project
forge deploy .
```

### Custom Subdomain
```bash
forge deploy --subdomain my-app https://github.com/username/repo
```

## Troubleshooting

### Permission Issues

#### "EACCES: permission denied" when setting up nginx
```bash
# Linux/macOS: Run with sudo
sudo forge infra --nginx

# Windows: Run PowerShell as Administrator
# Right-click PowerShell → "Run as administrator"
forge infra --nginx
```

#### Global npm package permissions
```bash
# Linux/macOS: Fix npm permissions or use sudo
sudo npm install -g forge-deploy-cli

# Windows: Run Command Prompt as Administrator
npm install -g forge-deploy-cli
```

### Port Conflicts
```bash
forge status                    # Check running deployments
forge stop <deployment-id>     # Stop conflicting deployment
```

### Service Issues
```bash
forge service status           # Check service status
pm2 list                       # Check PM2 processes
nginx -t                       # Test nginx configuration
```

### Infrastructure Issues
```bash
# Check if PM2 is properly installed
pm2 --version

# Check nginx status
sudo systemctl status nginx     # Linux
nginx -v                        # Check if installed

# Reinstall infrastructure
sudo forge infra --all
```

### Logs
```bash
forge logs <deployment-id>     # Application logs
pm2 logs                       # PM2 logs
sudo journalctl -u nginx       # Nginx logs (Linux)
tail -f /var/log/nginx/error.log # Nginx error logs
```

## License

MIT

## Support

For issues and documentation: [GitHub Repository](https://github.com/harshitkumar9030/cli)
