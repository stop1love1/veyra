import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 3001 by default so it doesn't clash with the Next.js client on 3000.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
