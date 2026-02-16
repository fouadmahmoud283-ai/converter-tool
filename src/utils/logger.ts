import kleur from 'kleur';

export class Logger {
  private verbose: boolean;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(kleur.cyan(message));
  }

  success(message: string): void {
    console.log(kleur.green(message));
  }

  warn(message: string): void {
    console.log(kleur.yellow(`⚠ ${message}`));
  }

  error(message: string): void {
    console.log(kleur.red(`✖ ${message}`));
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(kleur.gray(`  ${message}`));
    }
  }

  step(stepNumber: number, total: number, message: string): void {
    console.log(kleur.blue(`[${stepNumber}/${total}] ${message}`));
  }

  list(items: string[], indent = 2): void {
    const prefix = ' '.repeat(indent) + '• ';
    for (const item of items) {
      console.log(kleur.gray(prefix + item));
    }
  }

  divider(): void {
    console.log(kleur.gray('─'.repeat(50)));
  }

  blank(): void {
    console.log('');
  }
}
