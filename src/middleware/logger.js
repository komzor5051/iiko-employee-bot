/**
 * Middleware для логирования всех запросов к боту
 */
module.exports = () => {
  return (ctx, next) => {
    const start = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'no_username';
    const updateType = ctx.updateType;
    const text = ctx.message?.text?.substring(0, 50) || ctx.callbackQuery?.data || '';

    console.log(`→ [${userId}@${username}] ${updateType}: ${text}`);

    const result = next();

    const duration = Date.now() - start;
    console.log(`← [${userId}] Done in ${duration}ms`);

    return result;
  };
};
