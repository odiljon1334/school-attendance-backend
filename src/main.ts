import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Barcha manzillar uchun
  
  await app.listen(process.env.PORT ?? 3002);
  
  console.log(`Server is running on port ${process.env.PORT ?? 3002}`);
}
bootstrap();
