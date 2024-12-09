// @ts-check
import { userMiddleware } from '../../middleware/user';
import { logger } from '../../../logger';
import * as ordersActions from '../../ordersActions';

import * as commands from './commands';
import * as messages from './messages';
import { tooManyPendingOrdersMessage, notOrdersMessage } from '../../messages';
import { takeOrderActionValidation, takeOrderValidation, takesell, takebuyValidation, takebuy } from './takeOrder';
import { extractId } from '../../../util';
import { Telegraf } from 'telegraf';
import { CommunityContext } from '../community/communityContext';
export * as Scenes from './scenes';

export const configure = (bot: Telegraf<CommunityContext>) => {
  bot.command(
    'takeorder',
    userMiddleware,
    takeOrderValidation,
    commands.takeOrder
  );
  bot.command(
    'buy',
    userMiddleware,
    async (ctx, next) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) return next();
      if (ctx.message.chat.type !== 'private') return next();
      if (await commands.isMaxPending(ctx.user))
        return await tooManyPendingOrdersMessage(ctx, ctx.user, ctx.i18n);

      commands.buyWizard(ctx);
    },
    commands.buy
  );
  bot.command(
    'sell',
    userMiddleware,
    async (ctx, next) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) return next();
      if (ctx.message.chat.type !== 'private') return next();
      if (await commands.isMaxPending(ctx.user))
        return await tooManyPendingOrdersMessage(ctx, ctx.user, ctx.i18n);

      commands.sellWizard(ctx);
    },
    commands.sell
  );

  bot.command('listorders', userMiddleware, async ctx => {
    try {
      const orders = await ordersActions.getOrders(ctx.user);
      if (orders === undefined)
        throw new Error("orders is undefined");
      if (orders && orders.length === 0) {
        return await notOrdersMessage(ctx);
      }

      const { text, extra } = await messages.listOrdersResponse(
        orders,
        ctx.i18n
      );
      return ctx.reply(text, extra);
    } catch (error) {
      return logger.error(error);
    }
  });

  bot.action(
    'takesell',
    userMiddleware,
    takeOrderActionValidation,
    takeOrderValidation,
    async ctx => {
      const text = (ctx.update as any).callback_query.message.text;
      const orderId = extractId(text);
      if (!orderId) return;
      await takesell(ctx, bot, orderId);
    }
  );
  bot.action(
    'takebuy',
    userMiddleware,
    takeOrderActionValidation,
    takeOrderValidation,
    takebuyValidation,
    async ctx => {
      const text: string = (ctx.update as any).callback_query.message.text;
      const orderId = extractId(text);
      if (orderId === null) return;
      await takebuy(ctx, bot, orderId);
    }
  );
};
