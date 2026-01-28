/**
 * Регистрация всех handlers бота
 */
module.exports = (bot, services) => {
  const { sheetsService, iikoService } = services;

  // Регистрация
  require('./registration')(bot, sheetsService);

  // Shift handlers (будем добавлять позже)
  // require('./shift')(bot, sheetsService, iikoService);

  // Admin handlers (будем добавлять позже)
  // require('./admin')(bot, sheetsService);
};
