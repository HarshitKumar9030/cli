import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigService } from '../services/config';
import { ForgeApiService } from '../services/api';
import { LoginOptions } from '../types';

export async function loginCommand(options: LoginOptions): Promise<void> {
  console.log(chalk.blue.bold('Login to Forge'));

  const configService = new ConfigService();
  const config = await configService.getConfig();
  const apiService = new ForgeApiService(config.apiUrl);

  try {
    let email: string;
    let password: string;

    if (options.email && options.password) {
      email = options.email;
      password = options.password;
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Email:',
          validate: (input: string) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(input) || 'Please enter a valid email address';
          }
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          validate: (input: string) => input.length > 0 || 'Password is required'
        }
      ]);

      email = answers.email;
      password = answers.password;
    }

    console.log(chalk.gray('Authenticating...'));

    const response = await apiService.login(email, password);

    if (response.success && response.data?.user?.apiKey) {
      await configService.saveGlobalConfig({
        apiKey: response.data.user.apiKey
      });

      console.log(chalk.green('Login successful!'));
      console.log(chalk.gray(`Welcome back, ${response.data.user.username || email}`));
    } else {
      throw new Error(response.error?.message || 'Login failed');
    }

  } catch (error) {
    console.error(chalk.red('Login failed:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
