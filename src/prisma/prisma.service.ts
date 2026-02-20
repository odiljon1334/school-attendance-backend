import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('PrismaService');

  constructor() {
    // Prisma ulanish URL-ni dinamik ravishda tanlaymiz
    super({
      datasources: {
        db: {
          url: process.env.NODE_ENV === 'production' 
               ? process.env.DATABASE_URL_PROD 
               : process.env.DATABASE_URL_DEV,
        },
      },
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      
      const isProd = process.env.NODE_ENV === 'production';
      const currentUrl = isProd ? 'DATABASE_URL_PROD' : 'DATABASE_URL_DEV';
      
      console.log(`\x1b[32m✅ Database connected successfully!\x1b[0m`);
      console.log(`\x1b[36m📍 Using: ${currentUrl}\x1b[0m`);
    } catch (error) {
      this.logger.error('❌ Database connection failed!', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.warn('❌ Database disconnected');
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      this.logger.error('⚠️ Action blocked: Cannot clean database in PRODUCTION!');
      return;
    }

    const propertyNames = Object.getOwnPropertyNames(this);
    const modelKeys = propertyNames.filter(
      (key) => 
        key[0] !== '_' && 
        key[0] !== '$' && 
        typeof this[key] === 'object' && 
        this[key]?.deleteMany
    );

    this.logger.log('🧹 Cleaning all database tables...');
    
    return Promise.all(
      modelKeys.map((modelKey) => this[modelKey].deleteMany())
    );
  }
}