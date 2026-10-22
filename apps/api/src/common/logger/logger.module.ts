import { Global, Injectable, Logger, LoggerService, Module } from '@nestjs/common';

export type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

@Global()
@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger = new Logger(AppLogger.name);

  log(message: unknown, context?: string): void {
    this.safe('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.safe('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.safe('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.safe('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.safe('verbose', message, context);
  }

  private safe(level: LogLevel, message: unknown, context?: string, trace?: string): void {
    try {
      const text = typeof message === 'string' ? message : this.serialize(message);
      switch (level) {
        case 'error':
          this.logger.error(text, trace, context);
          break;
        case 'warn':
          this.logger.warn(text, context);
          break;
        case 'debug':
          this.logger.debug(text, context);
          break;
        case 'verbose':
          this.logger.verbose(text, context);
          break;
        default:
          this.logger.log(text, context);
      }
    } catch {
      // logging must never throw
    }
  }

  private serialize(value: unknown): string {
    if (value instanceof Error) return value.stack ?? value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
