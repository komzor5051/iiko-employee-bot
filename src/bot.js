const { Telegraf } = require('telegraf');
const config = require('./config/env');

const bot = new Telegraf(config.telegramToken);

// Middleware
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');

bot.use(logger());
errorHandler(bot);

module.exports = bot;
