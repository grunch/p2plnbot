import { Telegraf } from 'telegraf';

const commands = require('./commands');
const { userMiddleware } = require('../../middleware/user');

exports.configure = (bot: Telegraf) => {
  bot.command('block', userMiddleware, async (ctx, next) => {
    const args = ctx.message.text.split(' ') || [];
    if (args.length !== 2) return next();
    commands.block(ctx, args[1]);
  });

  bot.command('unblock', userMiddleware, async (ctx, next) => {
    const args = ctx.message.text.split(' ') || [];
    if (args.length !== 2) return next();
    commands.unblock(ctx, args[1]);
  });
  bot.command('blocklist', userMiddleware, commands.blocklist);
};
