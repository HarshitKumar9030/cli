import chalk from 'chalk';
import inquirer from 'inquirer';
import { ForgeApiService } from '../services/api';
import { ConfigService } from '../services/config';

interface SignupOptions {
  email?: string;
  username?: string;
  apiUrl?: string;
}

export async function signupCommand(options: SignupOptions): Promise<void> {
  try {
    console.log(chalk.blue('Sign up for Forge'));
    console.log(chalk.gray('Create a new account to deploy your applications'));
    console.log();

    const configService = new ConfigService();
    
    // Get API URL from options or config
    let apiUrl = options.apiUrl;
    if (!apiUrl) {
      const globalConfig = await configService.loadGlobalConfig();
      apiUrl = globalConfig?.apiUrl || 'https://api.agfe.tech';
    }

    const apiService = new ForgeApiService(apiUrl);

    // Get user input
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Email:',
        default: options.email,
        validate: (input: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(input)) {
            return 'Please enter a valid email address';
          }
          return true;
        },
        when: !options.email
      },
      {
        type: 'input',
        name: 'username',
        message: 'Username (optional):',
        default: options.username,
        when: !options.username
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
        validate: (input: string) => {
          if (input.length < 8) {
            return 'Password must be at least 8 characters long';
          }
          return true;
        }
      },
      {
        type: 'password',
        name: 'confirmPassword',
        message: 'Confirm password:',
        validate: (input: string, answers: any) => {
          if (input !== answers.password) {
            return 'Passwords do not match';
          }
          return true;
        }
      }
    ]);

    const email = options.email || answers.email;
    const username = options.username || answers.username;
    const password = answers.password;

    console.log();
    console.log(chalk.gray('Creating account...'));

    // Attempt signup
    const response = await apiService.signup(email, password, username);

    if (response.success) {
      console.log(chalk.green('Account created successfully!'));
      
      if (response.data?.apiKey) {
        // Save API key if provided
        const globalConfig = {
          apiKey: response.data.apiKey,
          apiUrl,
          email
        };
        await configService.saveGlobalConfig(globalConfig);
        console.log(chalk.green('API key saved to configuration'));
      }
      
      console.log();
      console.log(chalk.blue('Welcome to Forge!'));
      console.log(chalk.gray('You can now deploy your applications using "forge deploy"'));
      
      if (!response.data?.apiKey) {
        console.log(chalk.yellow('Please check your email for verification instructions'));
        console.log(chalk.gray('After verification, run "forge login" to get your API key'));
      }
    } else {
      throw new Error(response.error?.message || 'Signup failed');
    }

  } catch (error: any) {
    if (error.response?.status === 409) {
      console.log(chalk.red('Error: Email already exists'));
      console.log(chalk.gray('Try logging in instead: forge login'));
    } else if (error.response?.status === 400) {
      console.log(chalk.red('Error: Invalid input'));
      console.log(chalk.gray('Please check your email and password requirements'));
    } else if (error.response?.data?.error?.message) {
      console.log(chalk.red(`Error: ${error.response.data.error.message}`));
    } else {
      console.log(chalk.red(`Signup failed: ${error.message || error}`));
    }
    
    console.log();
    console.log(chalk.gray('If you already have an account, use "forge login"'));
    process.exit(1);
  }
}
