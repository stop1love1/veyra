import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Restrict CORS to an explicit allow-list (comma-separated CLIENT_ORIGIN env,
  // default the local Next.js client on :3000). Reflecting an arbitrary origin
  // while credentials are enabled is unsafe.
  const origins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  // 3001 by default so it doesn't clash with the Next.js client on 3000.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
