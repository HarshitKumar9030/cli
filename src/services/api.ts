import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ApiResponse, Deployment, DeploymentLog } from '../types';

export class ForgeApiService {
  private client: AxiosInstance;
  private apiKey?: string;

  constructor(baseURL: string = 'https://api.agfe.tech') {
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
    try {
      const response: AxiosResponse<ApiResponse<any>> = await this.client.post('/api/deployments', deploymentData);
      return response.data;
    } catch (error: any) {
      console.error('API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
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
}
