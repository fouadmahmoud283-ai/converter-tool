#!/usr/bin/env node
import { Command } from 'commander';
import kleur from 'kleur';
import path from 'node:path';
import fs from 'fs-extra';
import { convertRepository } from './convert.js';
import { generateConfigTemplate, generateConfigSchema, ConverterConfig } from './config.js';

const program = new Command();

program
  .name('deno-express-converter')
  .description('Convert Supabase Edge Functions (Deno) from Lovable projects into a fully self-hosted Express.js backend with PostgreSQL.')
  .version('0.1.0');

// Main convert command
program
  .command('convert')
  .description('Convert a repository to self-hosted Express backend')
  .argument('<repoUrl>', 'Git repository URL to clone and convert')
  .option('-o, --out <dir>', 'Output directory (defaults to repo name)')
  .option('-c, --config <file>', 'Path to converter.config.json')
  .option('--skip-frontend', 'Skip frontend integration updates', false)
  .option('--skip-docker', 'Skip Docker file generation', false)
  .option('--skip-swagger', 'Skip OpenAPI/Swagger generation', false)
  .option('--skip-validation', 'Skip Zod validation scaffolding', false)
  .option('--enable-clustering', 'Enable Node.js clustering support', false)
  .option('--no-auto-run', 'Skip auto npm install and server start')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Analyze without making changes', false)
  // Storage options
  .option('--storage <provider>', 'Storage provider: local, minio, or both (default: local)', 'local')
  .option('--minio-bucket <name>', 'MinIO default bucket name', 'files')
  .option('--db-name <name>', 'PostgreSQL database name', 'app')
  .action(async (repoUrl, options) => {
    try {
      console.log(kleur.bold().cyan('\n🔄 Deno → Express Converter (Full Migration)\n'));
      console.log(kleur.bold().green('📦 Creating self-hosted backend:\n'));
      console.log(kleur.dim('  ✓ PostgreSQL + Prisma ORM'));
      console.log(kleur.dim('  ✓ JWT Authentication (bcrypt + jsonwebtoken)'));
      console.log(kleur.dim(`  ✓ Storage: ${options.storage}`));
      if (options.storage === 'minio' || options.storage === 'both') {
        console.log(kleur.dim('  ✓ MinIO S3-compatible storage'));
      }
      console.log();
      
      // Load config file if provided
      let configFromFile: Partial<ConverterConfig> = {};
      if (options.config) {
        const configPath = path.resolve(process.cwd(), options.config);
        if (await fs.pathExists(configPath)) {
          configFromFile = await fs.readJson(configPath);
          console.log(kleur.dim(`Using config from: ${configPath}\n`));
        } else {
          console.error(kleur.red(`Config file not found: ${configPath}`));
          process.exit(1);
        }
      }
      
      // Always use self-hosted config
      const selfHostedConfig = {
        enabled: true,
        database: {
          host: 'localhost',
          port: 5432,
          name: options.dbName || 'app',
          user: 'postgres',
          password: 'postgres',
        },
        storage: {
          provider: options.storage as 'local' | 'minio' | 'both',
          localPath: './uploads',
          minio: {
            endpoint: 'localhost',
            port: 9000,
            useSSL: false,
            accessKey: 'minioadmin',
            secretKey: 'minioadmin',
            bucket: options.minioBucket || 'files',
          },
        },
        auth: {
          jwtSecret: 'your-jwt-secret-change-in-production',
          jwtExpiresIn: '15m',
          refreshExpiresIn: '7d',
          bcryptRounds: 12,
        },
      };
      
      // Merge CLI options with config file
      const config: Partial<ConverterConfig> = {
        ...configFromFile,
        docker: options.skipDocker ? false : configFromFile.docker,
        swagger: options.skipSwagger ? false : configFromFile.swagger,
        validation: options.skipValidation ? false : configFromFile.validation,
        clustering: options.enableClustering || configFromFile.clustering,
        updateFrontend: options.skipFrontend ? false : configFromFile.updateFrontend,
        selfHosted: selfHostedConfig,
      };
      
      await convertRepository({
        repoUrl,
        outDir: options.out,
        skipFrontend: options.skipFrontend,
        verbose: options.verbose,
        dryRun: options.dryRun,
        config,
        autoRun: options.autoRun,
      });
    } catch (error) {
      console.error(kleur.red(`\n✖ Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// Init command - create config file
program
  .command('init')
  .description('Create a converter.config.json template')
  .option('-f, --force', 'Overwrite existing config file')
  .action(async (options) => {
    const configPath = path.join(process.cwd(), 'converter.config.json');
    const schemaPath = path.join(process.cwd(), 'converter.schema.json');
    
    if (!options.force && await fs.pathExists(configPath)) {
      console.error(kleur.red('Config file already exists. Use --force to overwrite.'));
      process.exit(1);
    }
    
    await fs.writeFile(configPath, generateConfigTemplate(), 'utf8');
    await fs.writeFile(schemaPath, generateConfigSchema(), 'utf8');
    
    console.log(kleur.green('✓ Created converter.config.json'));
    console.log(kleur.green('✓ Created converter.schema.json'));
    console.log(kleur.dim('\nEdit the config file to customize the conversion.'));
  });

// Info command - show what will be converted
program
  .command('info')
  .description('Show project information without converting')
  .argument('<repoUrl>', 'Git repository URL to analyze')
  .action(async (repoUrl) => {
    await convertRepository({
      repoUrl,
      dryRun: true,
      verbose: true,
    });
  });

// Default action for backward compatibility
program
  .argument('[repoUrl]', 'Git repository URL (use "convert" command instead)')
  .option('-o, --out <dir>', 'Output directory')
  .option('--skip-frontend', 'Skip frontend integration', false)
  .option('--no-auto-run', 'Skip auto npm install and server start')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .option('--dry-run', 'Analyze without changes', false)
  .option('--storage <provider>', 'Storage provider: local, minio, or both', 'local')
  .action(async (repoUrl, options) => {
    if (repoUrl && repoUrl.startsWith('http')) {
      console.log(kleur.yellow('Tip: Use "convert" command: deno-express-converter convert <url>\n'));
      console.log(kleur.bold().cyan('🔄 Deno → Express Converter (Full Migration)\n'));
      
      // Always use self-hosted config
      const selfHostedConfig = {
        enabled: true,
        database: {
          host: 'localhost',
          port: 5432,
          name: 'app',
          user: 'postgres',
          password: 'postgres',
        },
        storage: {
          provider: (options.storage || 'local') as 'local' | 'minio' | 'both',
          localPath: './uploads',
          minio: {
            endpoint: 'localhost',
            port: 9000,
            useSSL: false,
            accessKey: 'minioadmin',
            secretKey: 'minioadmin',
            bucket: 'files',
          },
        },
        auth: {
          jwtSecret: 'your-jwt-secret-change-in-production',
          jwtExpiresIn: '15m',
          refreshExpiresIn: '7d',
          bcryptRounds: 12,
        },
      };
      
      await convertRepository({
        repoUrl,
        outDir: options.out,
        skipFrontend: options.skipFrontend,
        verbose: options.verbose,
        dryRun: options.dryRun,
        autoRun: options.autoRun,
        config: { selfHosted: selfHostedConfig },
      });
    } else if (!repoUrl) {
      program.help();
    }
  });

program.parseAsync(process.argv);
