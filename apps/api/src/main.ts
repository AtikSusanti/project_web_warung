import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const port = configService.get<number>('PORT') ?? 3000;

  app.setGlobalPrefix('api/v1');
  app.use(helmet({ contentSecurityPolicy: false }));

  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3002'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.use(cookieParser());

  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Warung API')
      .setDescription('REST API untuk Aplikasi Web Warung (POS + e-commerce + piutang)')
      .setVersion('1.0.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error) => {
  console.error('Gagal memulai aplikasi:', error);
  process.exitCode = 1;
});