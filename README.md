# Forge CLI

Professional command-line interface for deploying and managing applications locally with automatic subdomain routing, SSL certificates, and infrastructure management.

## Installation

```bash
npm install -g forge-deploy-cli
```

> **Note**: For full infrastructure setup (nginx, SSL), run with admin privileges on Windows or `sudo` on Linux/macOS.

## Quick Start

```bash
# 1. Setup infrastructure
forge infra --all

# 2. Authenticate
forge login

# 3. Deploy application
forge deploy https://github.com/HarshitKumar9030/Advanced-Calculator

# 4. Check status
forge status
```

Your app will be available at `https://subdomain.forgecli.tech` with automatic SSL certificates.

## Core Features

- **Local Deployments** - Deploy applications with auto-generated subdomains
- **SSL Certificates** - Automatic HTTPS with Let's Encrypt integration
- **Process Management** - PM2-based application lifecycle management
- **Framework Support** - Next.js, React, Vue, Node.js, Python, PHP, and more
- **Resource Monitoring** - Real-time CPU, memory, and disk usage tracking
- **Infrastructure Automation** - One-command setup for nginx, SSL, and services

## Commands

### Authentication
```bash
forge login                     # Login to your account
forge signup                    # Create new account
```

### Deployment
```bash
forge deploy [source]           # Deploy from repository or directory
forge deploy --subdomain name   # Use custom subdomain
forge status                    # View all deployments
forge info [deployment-id]      # Detailed deployment information
forge logs [deployment-id]      # View application logs
forge stop [deployment-id]      # Stop deployment
```

### Infrastructure
```bash
forge infra --all               # Setup complete infrastructure
forge infra --nginx             # Configure nginx reverse proxy
forge infra --ssl               # Setup SSL certificates
forge service status            # Check service status
```

## Infrastructure Setup

Forge automatically configures:

1. **Nginx** - Reverse proxy with per-subdomain configurations
2. **SSL/TLS** - Automatic certificate generation and renewal
3. **PM2** - Process management and monitoring
4. **System Service** - Auto-restart on system boot

### Platform-Specific Setup

**Windows**: Requires Administrator privileges for nginx and service installation.

**Linux/macOS**: Requires `sudo` for system-level configurations.

```bash
# Linux/macOS
sudo forge infra --all

# Windows (Run as Administrator)
forge infra --all
```

## Supported Frameworks

| Category | Frameworks |
|----------|------------|
| Frontend | React, Vue, Angular, Next.js, Nuxt, Svelte |
| Backend | Node.js, Express, NestJS, Python, Django, Flask, FastAPI |
| Static | HTML/CSS/JS, Jekyll, Hugo |

## Example Usage

```bash
# Deploy a calculator app
forge deploy https://github.com/HarshitKumar9030/Advanced-Calculator

# Deploy with custom subdomain
forge deploy --subdomain calculator https://github.com/HarshitKumar9030/Advanced-Calculator

# Deploy local project
forge deploy ./my-project

# Monitor deployment
forge info deployment-id
```

## Configuration

DNS configuration is managed automatically. Your applications will be accessible at:
```
https://subdomain.forgecli.tech
```

Required firewall ports:
- **80** (HTTP)
- **443** (HTTPS)

## Troubleshooting

### Common Issues

**Permission Denied**: Run with administrator/sudo privileges
```bash
sudo forge infra --all    # Linux/macOS
# Run as Administrator     # Windows
```

**Port Conflicts**: Check and stop conflicting deployments
```bash
forge status
forge stop deployment-id
```

**Service Issues**: Restart infrastructure services
```bash
forge service status
pm2 restart all
sudo systemctl restart nginx
```

### Getting Help

View detailed logs:
```bash
forge logs deployment-id       # Application logs
forge info deployment-id       # Deployment details
```

## Support

- **Email**: [harshitkumar9030@gmail.com](mailto:harshitkumar9030@gmail.com)
- **Documentation**: [https://forgecli.tech/docs](https://forgecli.tech/docs)
- **Issues**: [GitHub Repository](https://github.com/HarshitKumar9030/cli)

## License

MIT License - see LICENSE file for details.
