import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponse, Deployment, DeploymentLog } from '../types';

export class ForgeApiService {
  private client: AxiosInstance;
  private apiKey?: string;

  constructor(baseURL: string = 'https://api.forgecli.tech') {
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers.Authorization = `Bearer ${this.apiKey}`;
      }
      return config;
    });
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async login(email: string, password: string): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.post('/api/auth/login', {
      email,
      password,
    });
    return response.data;
  }

  async signup(email: string, password: string, username?: string): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.post('/api/auth/signup', {
      email,
      password,
      username,
    });
    return response.data;
  }

  async verifyApiKey(): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.get('/api/auth/verify');
    return response.data;
  }

  async createDeployment(deploymentData: any): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.post('/api/deployments', deploymentData);
    return response.data;
  }

  async getDeployments(filters?: any): Promise<ApiResponse<{ deployments: Deployment[] }>> {
    const params = new URLSearchParams();
    if (filters) {
      Object.keys(filters).forEach(key => {
        if (filters[key]) params.append(key, filters[key]);
      });
    }
    
    const response: AxiosResponse<ApiResponse<{ deployments: Deployment[] }>> = await this.client.get(
      `/api/deployments?${params.toString()}`
    );
    return response.data;
  }

  async getDeploymentLogs(deploymentId: string): Promise<ApiResponse<{ logs: DeploymentLog[] }>> {
    const response: AxiosResponse<ApiResponse<{ logs: DeploymentLog[] }>> = await this.client.get(
      `/api/deployments/${deploymentId}/logs`
    );
    return response.data;
  }

  async getHealthStatus(): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.get('/api/health');
    return response.data;
  }

  async createSubdomain(subdomainData: any): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.post('/api/subdomains', subdomainData);
    return response.data;
  }

  async updateSubdomain(deploymentId: string, publicIP: string): Promise<ApiResponse<any>> {
    const response: AxiosResponse<ApiResponse<any>> = await this.client.put('/api/subdomains', {
      deploymentId,
      publicIP
    });
    return response.data;
  }

  async getSubdomains(filters?: any): Promise<ApiResponse<any>> {
    const params = new URLSearchParams();
    if (filters) {
      Object.keys(filters).forEach(key => {
        if (filters[key]) params.append(key, filters[key]);
      });
    }
    
    const response: AxiosResponse<ApiResponse<any>> = await this.client.get(
      `/api/subdomains?${params.toString()}`
    );
    return response.data;
  }
}
