/**
 * Middleware для обработки ошибок бота
 */
module.exports = (bot) => {
  bot.catch((err, ctx) => {
    const userId = ctx?.from?.id || 'unknown';
    const updateType = ctx?.updateType || 'unknown';

    console.error(`❌ Ошибка бота [${userId}] ${updateType}:`, err.message);
    console.error(err.stack);

    // Игнорируем старые callback queries
    if (err.message && err.message.includes('query is too old')) {
      return;
    }

    // Rate limiting от Telegram
    if (err.code === 'ETELEGRAM' && err.response?.error_code === 429) {
      console.warn(`🛑 Rate limited for user ${userId}`);
      return;
    }

    // Отправляем user-friendly сообщение
    try {
      ctx.reply('❌ Произошла ошибка. Попробуй позже или обратись к администратору.');
    } catch (e) {
      console.error('Не удалось отправить сообщение об ошибке:', e);
    }
  });
};
