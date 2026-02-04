const http = require('http');
const config = require('../config/env');

/**
 * HTTP сервер для приёма webhooks от iiko Cloud API
 */
class WebhookServer {
  constructor(onWebhook) {
    this.port = config.port;
    this.authToken = config.iikoWebhookToken;
    this.onWebhook = onWebhook;
    this.server = null;
  }

  /**
   * Запуск HTTP сервера
   */
  start() {
    this.server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // Handle OPTIONS (preflight)
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check endpoint (/ and /health)
      if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      // iiko webhook endpoint
      if (req.method === 'POST' && req.url === '/iiko-webhook') {
        this.handleIikoWebhook(req, res);
        return;
      }

      // 404 for other routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.server.listen(this.port, () => {
      console.log(`🌐 Webhook сервер запущен на порту ${this.port}`);
      console.log(`   Health check: http://localhost:${this.port}/health`);
      console.log(`   iiko webhook: http://localhost:${this.port}/iiko-webhook`);
    });

    return this.server;
  }

  /**
   * Обработка webhook от iiko
   */
  handleIikoWebhook(req, res) {
    // Проверка авторизации
    const authHeader = req.headers['authorization'] || '';

    // iiko может отправлять токен как "Bearer TOKEN" или просто "TOKEN"
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!this.authToken || token !== this.authToken) {
      console.warn('⚠️ Webhook: неверный токен авторизации');
      console.warn(`   Получен: "${authHeader.slice(0, 20)}..."`);
      console.warn(`   Ожидается: "${this.authToken ? this.authToken.slice(0, 10) + '...' : 'НЕ НАСТРОЕН'}"`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Собираем body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        console.log('📨 Получен webhook от iiko:', {
          eventType: data.eventType,
          eventTime: data.eventTime,
          organizationId: data.organizationId
        });

        // Логируем полные данные для отладки
        console.log('📋 Полные данные webhook:', JSON.stringify(data, null, 2));

        // Вызываем обработчик
        if (this.onWebhook) {
          await this.onWebhook(data);
        }

        // Отвечаем 200 OK
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

      } catch (error) {
        console.error('❌ Ошибка обработки webhook:', error.message);
        console.error('Raw body:', body);

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    req.on('error', (error) => {
      console.error('❌ Ошибка запроса webhook:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  }

  /**
   * Остановка сервера
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        console.log('🛑 Webhook сервер остановлен');
      });
    }
  }
}

module.exports = WebhookServer;
