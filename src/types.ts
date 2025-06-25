export interface ForgeConfig {
  apiUrl: string;
  apiKey?: string;
  projectName?: string;
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
  environmentVariables?: Record<string, string>;
  deploymentId?: string;
}

export interface DeploymentOptions {
  environment: string;
  branch: string;
  skipBuild: boolean;
  force: boolean;
}

export interface SetupOptions {
  platform?: string;
  framework?: string;
  skipInstall: boolean;
}

export interface LoginOptions {
  email?: string;
  password?: string;
}

export interface StatusOptions {
  deploymentId?: string;
  all: boolean;
}

export interface LogsOptions {
  follow: boolean;
  lines: string;
  deploymentId?: string;
}

export interface ConfigOptions {
  set?: string;
  get?: string;
  list: boolean;
}

export interface InitOptions {
  template?: string;
  yes: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
  };
}

export interface Deployment {
  id: string;
  userId: string;
  subdomain: string;
  projectName: string;
  status: string;
  url: string;
  framework: string;
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
  healthStatus: string;
}

export interface DeploymentLog {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source: string;
}

export enum Framework {
  NEXTJS = 'next.js',
  REACT = 'react',
  VUE = 'vue',
  NUXT = 'nuxt',
  SVELTE = 'svelte',
  ANGULAR = 'angular',
  EXPRESS = 'express',
  FASTIFY = 'fastify',
  NEST = 'nest',
  DJANGO = 'django',
  FLASK = 'flask',
  FASTAPI = 'fastapi',
  LARAVEL = 'laravel',
  SYMFONY = 'symfony',
  WORDPRESS = 'wordpress',
  STATIC = 'static'
}

export enum Platform {
  DOCKER = 'docker',
  NGINX = 'nginx',
  PM2 = 'pm2',
  SYSTEMD = 'systemd'
}

export enum DevPlatform {
  NODEJS = 'nodejs',
  PYTHON = 'python',
  PHP = 'php',
  STATIC = 'static'
}
