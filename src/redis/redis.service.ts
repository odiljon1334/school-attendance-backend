import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis, { Redis as RedisClient } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient;

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.logger.log('✅ Redis connected');
    });

    this.client.on('error', (err) => {
      this.logger.error('❌ Redis error:', err);
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
    this.logger.warn('Redis disconnected');
  }

  getClient(): RedisClient {
    return this.client;
  }

  // ==========================================
  // ✅ BASIC OPERATIONS
  // ==========================================
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string | number | Buffer, ttlSeconds?: number) {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  // ==========================================
  // ✅ TELEGRAM SESSION (Redis bilan)
  // ==========================================
  async setTelegramSession(chatId: string, data: any, ttl: number = 3600) {
    const key = `tg:session:${chatId}`;
    await this.set(key, JSON.stringify(data), ttl);
  }

  async getTelegramSession(chatId: string): Promise<any> {
    const key = `tg:session:${chatId}`;
    const data = await this.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteTelegramSession(chatId: string) {
    const key = `tg:session:${chatId}`;
    await this.del(key);
  }

  // ==========================================
  // ✅ CACHE (davomat va boshqa)
  // ==========================================
  async setCache(key: string, data: any, ttl: number = 300) {
    await this.set(`cache:${key}`, JSON.stringify(data), ttl);
  }

  async getCache(key: string): Promise<any> {
    const data = await this.get(`cache:${key}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteCache(key: string) {
    await this.del(`cache:${key}`);
  }

  async deleteCachePattern(pattern: string) {
    const keys = await this.keys(`cache:${pattern}`);
    if (keys.length > 0) {
      await this.del(...keys);
    }
  }

  // ==========================================
  // ✅ SMS RATE LIMITING
  // ==========================================
  async checkSmsRateLimit(
    phone: string,
    maxPerMinute: number,
    type: string,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetIn: number;
  }> {
    const key = `sms:limit:${type}:${phone}`;
    const count = await this.client.incr(key);

    if (count === 1) {
      await this.expire(key, 60); // 1 minute
    }

    const ttl = await this.ttl(key);
    const remaining = Math.max(0, maxPerMinute - count);

    return {
      allowed: count <= maxPerMinute,
      remaining,
      resetIn: ttl > 0 ? ttl : 0,
    };
  }

  async getSmsCount(phone: string): Promise<number> {
    const key = `sms:limit:${phone}`;
    const count = await this.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  // redis.service.ts ga qo'shing:
  async isFirstSms(phone: string): Promise<boolean> {
    const key = `sms:first:${phone}`;
    const exists = await this.client.exists(key);
    if (!exists) {
      await this.client.set(key, '1'); // TTL yo'q — permanent
      return true; // birinchi SMS
    }
    return false;
  }

  // ==========================================
  // ✅ COUNTERS (real-time)
  // ==========================================
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrementCounter(key: string, ttl?: number): Promise<number> {
    const fullKey = `counter:${key}`;
    const count = await this.incr(fullKey);

    if (ttl && count === 1) {
      await this.expire(fullKey, ttl);
    }

    return count;
  }

  async getCounter(key: string): Promise<number> {
    const fullKey = `counter:${key}`;
    const count = await this.get(fullKey);
    return count ? parseInt(count, 10) : 0;
  }

  async resetCounter(key: string) {
    const fullKey = `counter:${key}`;
    await this.del(fullKey);
  }

  // ==========================================
  // ✅ DAILY COUNTERS (attendance uchun)
  // ==========================================
  async incrementTodayCheckIn(schoolId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `checkin:${schoolId}:${today}`;
    return await this.incrementCounter(key, 86400); // 24 soat
  }

  async getTodayCheckInCount(schoolId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `checkin:${schoolId}:${today}`;
    return await this.getCounter(key);
  }

  async incrementTodaySms(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `sms:sent:${today}`;
    return await this.incrementCounter(key, 86400);
  }

  async getTodaySmsCount(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `sms:sent:${today}`;
    return await this.getCounter(key);
  }

  // ==========================================
  // ✅ SETS (track keys for invalidation)
  // ==========================================
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.srem(key, ...members);
  }

  // ==========================================
  // ✅ SORTED SETS (leaderboard)
  // ==========================================
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zrevrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<Array<{ member: string; score: number }>> {
    const results = await this.client.zrevrange(key, start, stop, 'WITHSCORES');

    const leaderboard = [];
    for (let i = 0; i < results.length; i += 2) {
      leaderboard.push({
        member: results[i],
        score: parseFloat(results[i + 1]),
      });
    }

    return leaderboard;
  }

  async updateAttendanceLeaderboard(
    schoolId: string,
    studentId: string,
    attendanceCount: number,
  ) {
    const key = `leaderboard:attendance:${schoolId}`;
    await this.zadd(key, attendanceCount, studentId);
  }

  async getTopAttendanceStudents(
    schoolId: string,
    limit: number = 10,
  ): Promise<Array<{ studentId: string; count: number }>> {
    const key = `leaderboard:attendance:${schoolId}`;
    const results = await this.zrevrangeWithScores(key, 0, limit - 1);

    return results.map((r) => ({
      studentId: r.member,
      count: r.score,
    }));
  }

  // ==========================================
  // ✅ HASH (structured data)
  // ==========================================
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (fields.length === 0) return 0;
    return this.client.hdel(key, ...fields);
  }

  // ==========================================
  // ✅ STATS / MONITORING
  // ==========================================
  async getStats() {
    const info = await this.client.info();
    const dbSize = await this.client.dbsize();

    return {
      connected: this.client.status === 'ready',
      dbSize,
      info: this.parseRedisInfo(info),
    };
  }

  private parseRedisInfo(info: string) {
    const lines = info.split('\r\n');
    const parsed: any = {};

    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          parsed[key] = value;
        }
      }
    }

    return parsed;
  }

  // ==========================================
  // ✅ FLUSH (for development only)
  // ==========================================
  async flushAll() {
    if (process.env.NODE_ENV === 'production') {
      this.logger.error('⚠️ Cannot flush Redis in production!');
      return;
    }
    await this.client.flushall();
    this.logger.warn('🧹 Redis flushed (all data deleted)');
  }
}