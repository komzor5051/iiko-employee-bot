const { Telegraf } = require('telegraf');
const config = require('./config/env');

const bot = new Telegraf(config.telegramToken);

// Игнорируем сообщения из групп — бот работает только в личных чатах
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') return;
  return next();
});

// Middleware
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

bot.use(logger());
errorHandler(bot);

module.exports = bot;
