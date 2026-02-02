const axios = require('axios');

/**
 * Сервис для работы с iiko Cloud API
 * Управляет токенами, открытием/закрытием смен
 */
class IikoService {
  constructor(baseUrl, apiLogin, organizationId, terminalGroupId) {
    this.baseUrl = baseUrl;
    this.apiLogin = apiLogin;
    this.organizationId = organizationId;
    this.terminalGroupId = terminalGroupId;

    // Управление токеном
    this.token = null;
    this.tokenCreatedAt = null;
    this.TOKEN_LIFETIME = 3600000; // 1 час в миллисекундах
    this.REFRESH_BEFORE = 300000; // Обновлять за 5 минут до истечения
  }

  /**
   * Получить новый access token от iiko API
   * @returns {string} - Access token
   */
  async getAccessToken() {
    try {
      console.log('🔑 Запрос нового токена iiko...');

      const response = await axios.post(
        `${this.baseUrl}/api/1/access_token`,
        { apiLogin: this.apiLogin },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      this.token = response.data.token;
      this.tokenCreatedAt = Date.now();

      console.log('✅ Токен iiko получен');

      return this.token;
    } catch (error) {
      console.error('❌ Ошибка получения токена iiko:', error.message);

      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }

      throw new Error(`Не удалось получить токен iiko: ${error.message}`);
    }
  }

  /**
   * Проверить валидность токена и обновить при необходимости
   * @returns {string} - Валидный токен
   */
  async ensureValidToken() {
    const now = Date.now();

    // Проверяем, нужно ли обновить токен
    if (
      !this.token ||
      !this.tokenCreatedAt ||
      (now - this.tokenCreatedAt) > (this.TOKEN_LIFETIME - this.REFRESH_BEFORE)
    ) {
      await this.getAccessToken();
    }

    return this.token;
  }

  /**
   * Выполнить HTTP запрос к iiko API с retry логикой
   * @param {string} endpoint - Эндпоинт (например, 'employees/openPersonalSession')
   * @param {string} method - HTTP метод
   * @param {Object} body - Тело запроса
   * @param {number} retryCount - Текущая попытка
   * @returns {Object} - Ответ от API
   */
  async makeRequest(endpoint, method = 'POST', body = null, retryCount = 0) {
    const maxRetries = 3;

    try {
      const token = await this.ensureValidToken();

      const config = {
        method,
        url: `${this.baseUrl}/api/1/${endpoint}`,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      };

      if (body) {
        config.data = body;
      }

      const response = await axios(config);

      return response.data;
    } catch (error) {
      const status = error.response?.status;

      // 401 Unauthorized - токен невалиден, обновляем
      if (status === 401 && retryCount < maxRetries) {
        console.log('⚠️ Токен невалиден, обновляем...');
        this.token = null; // Сбрасываем токен
        await this.getAccessToken();

        return this.makeRequest(endpoint, method, body, retryCount + 1);
      }

      // 429 Too Many Requests или 503 Service Unavailable - retry с backoff
      if ((status === 429 || status === 503) && retryCount < maxRetries) {
        const retryAfter = error.response?.headers['retry-after'];
        const delay = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.pow(2, retryCount) * 1000 + Math.random() * 1000; // Exponential backoff + jitter

        console.log(`⏳ Retry ${retryCount + 1}/${maxRetries} через ${Math.round(delay / 1000)}с...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        return this.makeRequest(endpoint, method, body, retryCount + 1);
      }

      // Timeout - retry
      if (error.code === 'ECONNABORTED' && retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.log(`⏱️ Timeout. Retry ${retryCount + 1}/${maxRetries} через ${Math.round(delay / 1000)}с...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        return this.makeRequest(endpoint, method, body, retryCount + 1);
      }

      // Логируем ошибку
      console.error(`❌ Ошибка iiko API (${endpoint}):`, error.message);

      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }

      throw error;
    }
  }

  /**
   * Открыть смену сотрудника в iiko
   * @param {string} iikoEmployeeId - ID сотрудника в iiko
   * @returns {Object} - Ответ от API
   */
  async openShift(iikoEmployeeId) {
    try {
      console.log(`📥 Открытие смены для сотрудника ${iikoEmployeeId}...`);

      const response = await this.makeRequest(
        'employees/shift/clockin',
        'POST',
        {
          organizationId: this.organizationId,
          employeeId: iikoEmployeeId,
          terminalGroupId: this.terminalGroupId
        }
      );

      console.log(`✅ Смена открыта в iiko для ${iikoEmployeeId}`);

      return response;
    } catch (error) {
      console.error('❌ Ошибка открытия смены в iiko:', error.message);
      throw new Error(`Не удалось открыть смену: ${error.message}`);
    }
  }

  /**
   * Закрыть смену сотрудника в iiko
   * @param {string} iikoEmployeeId - ID сотрудника в iiko
   * @returns {Object} - Ответ от API
   */
  async closeShift(iikoEmployeeId) {
    try {
      console.log(`📤 Закрытие смены для сотрудника ${iikoEmployeeId}...`);

      const response = await this.makeRequest(
        'employees/shift/clockout',
        'POST',
        {
          organizationId: this.organizationId,
          employeeId: iikoEmployeeId,
          terminalGroupId: this.terminalGroupId
        }
      );

      console.log(`✅ Смена закрыта в iiko для ${iikoEmployeeId}`);

      return response;
    } catch (error) {
      console.error('❌ Ошибка закрытия смены в iiko:', error.message);
      throw new Error(`Не удалось закрыть смену: ${error.message}`);
    }
  }

  /**
   * Получить список курьеров из iiko
   * @returns {Array} - Массив сотрудников с id, displayName, lastName, firstName
   */
  async getCouriers() {
    try {
      console.log('📋 Получение списка курьеров из iiko...');

      const response = await this.makeRequest(
        'employees/couriers',
        'POST',
        {
          organizationIds: [this.organizationId]
        }
      );

      const employees = response.employees?.[0]?.items || [];

      // Фильтруем удалённых и системных пользователей
      const activeEmployees = employees.filter(emp =>
        !emp.isDeleted &&
        emp.lastName &&
        !emp.displayName?.includes('iikoTransport') &&
        !emp.displayName?.includes('централизованной доставки') &&
        !emp.displayName?.includes('не удалять')
      );

      console.log(`✅ Получено ${activeEmployees.length} активных курьеров из iiko`);

      return activeEmployees;
    } catch (error) {
      console.error('❌ Ошибка получения курьеров:', error.message);
      throw error;
    }
  }

  /**
   * Проверить статус смены сотрудника (опционально, если API поддерживает)
   * @param {string} iikoEmployeeId - ID сотрудника в iiko
   * @returns {Object} - Статус смены
   */
  async getShiftStatus(iikoEmployeeId) {
    try {
      // Примечание: Этот эндпоинт может отличаться в зависимости от версии iiko API
      // Проверьте документацию iiko для точного эндпоинта
      const response = await this.makeRequest(
        'employees/getPersonalSessionStatus',
        'POST',
        {
          organizationId: this.organizationId,
          employeeId: iikoEmployeeId,
          terminalGroupId: this.terminalGroupId
        }
      );

      return response;
    } catch (error) {
      console.error('❌ Ошибка получения статуса смены:', error.message);
      // Не выбрасываем ошибку, т.к. этот метод опционален
      return null;
    }
  }

  // ==================== WEBHOOK МЕТОДЫ ====================

  /**
   * Получить текущие настройки webhooks
   * @returns {Object} - Настройки webhooks
   */
  async getWebhookSettings() {
    try {
      console.log('📋 Получение настроек webhooks...');

      const response = await this.makeRequest(
        'webhooks/settings',
        'POST',
        {
          organizationId: this.organizationId
        }
      );

      console.log('✅ Настройки webhooks получены');
      return response;
    } catch (error) {
      console.error('❌ Ошибка получения настроек webhooks:', error.message);
      throw error;
    }
  }

  /**
   * Обновить настройки webhooks
   * @param {string} webhookUrl - URL для получения webhooks
   * @param {string} authToken - Токен авторизации
   * @param {Object} filters - Фильтры событий
   * @returns {Object} - Результат обновления
   */
  async updateWebhookSettings(webhookUrl, authToken, filters = {}) {
    try {
      console.log(`🔧 Настройка webhooks: ${webhookUrl}`);

      const body = {
        organizationId: this.organizationId,
        webhooksUri: webhookUrl,
        authToken: authToken
      };

      // Добавляем фильтры событий если указаны
      // Доступные фильтры:
      // - deliveryOrderUpdateFilter: фильтр событий заказов доставки
      // - reserveUpdateFilter: фильтр событий резервов
      // - tableOrderUpdateFilter: фильтр событий заказов на столик
      // - stopListUpdateFilter: фильтр событий стоп-листа
      // - personalShiftFilter: фильтр событий личных смен
      if (filters.deliveryOrderUpdate !== undefined) {
        body.deliveryOrderUpdateFilter = filters.deliveryOrderUpdate;
      }
      if (filters.reserveUpdate !== undefined) {
        body.reserveUpdateFilter = filters.reserveUpdate;
      }
      if (filters.tableOrderUpdate !== undefined) {
        body.tableOrderUpdateFilter = filters.tableOrderUpdate;
      }
      if (filters.stopListUpdate !== undefined) {
        body.stopListUpdateFilter = filters.stopListUpdate;
      }
      if (filters.personalShift !== undefined) {
        body.personalShiftFilter = filters.personalShift;
      }

      const response = await this.makeRequest(
        'webhooks/update_settings',
        'POST',
        body
      );

      console.log('✅ Настройки webhooks обновлены');
      return response;
    } catch (error) {
      console.error('❌ Ошибка обновления webhooks:', error.message);
      throw error;
    }
  }
}

module.exports = IikoService;
