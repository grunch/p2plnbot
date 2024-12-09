import { Telegraf, session, Context, Telegram } from 'telegraf';
import { I18n, I18nContext } from '@grammyjs/i18n';
import { Message } from 'typegram'
import { UserDocument } from '../models/user'
import { FilterQuery } from 'mongoose';
import * as OrderEvents from './modules/events/orders';
import { limit } from "@grammyjs/ratelimiter"
import schedule from 'node-schedule';
import {
  Order,
  User,
  PendingPayment,
  Community,
  Dispute,
  Config,
} from '../models';
import { getCurrenciesWithPrice, deleteOrderFromChannel, removeAtSymbol } from '../util';
import {
  commandArgsMiddleware,
  stageMiddleware,
  userMiddleware,
  adminMiddleware,
  superAdminMiddleware,
} from './middleware';
import * as ordersActions from './ordersActions';
import * as CommunityModule from './modules/community';
import * as LanguageModule from './modules/language';
import * as NostrModule from './modules/nostr';
import * as OrdersModule from './modules/orders';
import * as UserModule from './modules/user';
import * as DisputeModule from './modules/dispute';
import {
  rateUser,
  cancelAddInvoice,
  addInvoice,
  cancelShowHoldInvoice,
  showHoldInvoice,
  addInvoicePHI,
  cancelOrder,
  fiatSent,
  release,
} from './commands';
import {
  validateUser,
  validateParams,
  validateObjectId,
  validateLightningAddress,
} from './validations';
import * as messages from './messages';
import {
  attemptPendingPayments,
  cancelOrders,
  deleteOrders,
  calculateEarnings,
  attemptCommunitiesPendingPayments,
  deleteCommunity,
  nodeInfo,
} from '../jobs';
import { logger } from "../logger";
import { IUsernameId } from '../models/community';
import { CommunityContext } from './modules/community/communityContext';

const {
  settleHoldInvoice,
  cancelHoldInvoice,
  payToBuyer,
  subscribeInvoice,
  getInvoice,
} = require('../ln');

export interface MainContext extends Context {
  match: Array<string> | null;
  i18n: I18nContext;
  user: UserDocument;
  admin: UserDocument;
}

export interface OrderQuery {
  status?: string;
  buyer_id?: string;
  seller_id?: string;
}

export interface HasTelegram {
  telegram: Telegram;
}

const askForConfirmation = async (user: UserDocument, command: string) => {
  try {
    let orders: any[] = [];
    if (command === '/cancel') {
      const where: FilterQuery<OrderQuery> = {
        $and: [
          { $or: [{ buyer_id: user._id }, { seller_id: user._id }] },
          {
            $or: [
              { status: 'ACTIVE' },
              { status: 'PENDING' },
              { status: 'FIAT_SENT' },
              { status: 'DISPUTE' },
            ],
          },
        ]
      };
      orders = await Order.find(where);
    } else if (command === '/fiatsent') {
      const where: FilterQuery<OrderQuery> = {
        $and: [{ buyer_id: user._id }, { status: 'ACTIVE' }]
      };
      orders = await Order.find(where);
    } else if (command === '/release') {
      const where: FilterQuery<OrderQuery> = {
        $and: [
          { seller_id: user._id },
          {
            $or: [
              { status: 'ACTIVE' },
              { status: 'FIAT_SENT' },
              { status: 'DISPUTE' },
            ],
          },
        ]
      };
      orders = await Order.find(where);
    } else if (command === '/setinvoice') {
      const where: FilterQuery<OrderQuery> = {
        $and: [
          { buyer_id: user._id },
          {
            $or: [
              { status: 'PAID_HOLD_INVOICE' },
              { status: 'FROZEN' },
            ],
          },
        ]
      };
      orders = await Order.find(where);
    }

    return orders;
  } catch (error) {
    logger.error(error);
    return null;
  }
};

/*
ctx.update doesn't initially contain message field and it might be
added to the ctx.update in specific conditions. Therefore we need
to check the existence of message in ctx.update. ctx.update.message.text
has the same condition.

The problem mentioned above is similar to this issue:
https://github.com/telegraf/telegraf/issues/1319#issuecomment-766360594
*/
export const ctxUpdateAssertMsg = "ctx.update.message.text is not available.";

const initialize = (botToken: string, options: Partial<Telegraf.Options<CommunityContext>>): Telegraf<CommunityContext> => {
  const i18n = new I18n({
    defaultLanguageOnMissing: true, // implies allowMissing = true
    directory: 'locales',
    useSession: true,
  });

  const bot = new Telegraf<CommunityContext>(botToken, options);
  bot.catch(err => {
    logger.error(err);
  });

  bot.use(session());
  bot.use(limit());
  bot.use(i18n.middleware());
  bot.use(stageMiddleware());
  bot.use(commandArgsMiddleware());

  // We schedule pending payments job
  schedule.scheduleJob(
    `*/${process.env.PENDING_PAYMENT_WINDOW} * * * *`,
    async (): Promise<void> => {
      await attemptPendingPayments(bot);
    }
  );

  schedule.scheduleJob(`*/20 * * * * *`, async () => {
    await cancelOrders(bot);
  });

  schedule.scheduleJob(`25 * * * *`, async () => {
    await deleteOrders(bot);
  });

  schedule.scheduleJob(`*/10 * * * *`, async () => {
    await calculateEarnings();
  });

  schedule.scheduleJob(`*/5 * * * *`, async (): Promise<void> => {
    await attemptCommunitiesPendingPayments(bot);
  });

  schedule.scheduleJob(`33 0 * * *`, async () => {
    await deleteCommunity(bot);
  });

  schedule.scheduleJob(`* * * * *`, async () => {
    await nodeInfo(bot);
  });

  bot.start(async (ctx: MainContext) => {
    try {
      if (!('message' in ctx.update) || !('text' in ctx.update.message)){
        throw new Error(ctxUpdateAssertMsg);
      }

      await validateUser(ctx, true);
      await messages.startMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('maintenance', superAdminMiddleware, async (ctx: MainContext): Promise<void> => {
    try {
      const [val] = (await validateParams(ctx, 2, '\\<_on/off_\\>'))!;
      if (!val) return;
      let config = await Config.findOne();
      if (config === null) {
        config = new Config();
      }
      config.maintenance = false;
      if (val == 'on') {
        config.maintenance = true;
      }
      await config.save();
      await ctx.reply(ctx.i18n.t('operation_successful'));
    } catch (error) {
      logger.error(error);
    }
  });

  bot.on('text', userMiddleware, async (ctx: MainContext, next: () => void) => {
    try {
      const config = await Config.findOne({ maintenance: true });
      if (config) {
        await ctx.reply(ctx.i18n.t('maintenance'));
      } else {
        next();
      }
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('version', async (ctx: MainContext) => {
    try {
      const pckg = require('../package.json');
      await ctx.reply(pckg.version);
    } catch (err) {
      logger.error(err);
    }
  });

  UserModule.configure(bot);
  NostrModule.configure(bot);
  CommunityModule.configure(bot);
  LanguageModule.configure(bot);

  bot.command('release', userMiddleware, async ctx => {
    try {
      if (!('message' in ctx.update) || !('text' in ctx.update.message)){
        throw new Error(ctxUpdateAssertMsg);
      }
      const params = ctx.update.message.text.split(' ');
      const [command, orderId] = params.filter((el: string) => el);

      if (!orderId) {
        const orders = await askForConfirmation(ctx.user, command);
        if (orders === null || orders.length === 0) return await ctx.reply(`${command} <order Id>`);

        return await messages.showConfirmationButtons(ctx, orders, command);
      } else if (!(await validateObjectId(ctx, orderId))) {
        // eslint-disable-next-line no-useless-return
        return;
      } else {
        await release(ctx, orderId, ctx.user);
      }
    } catch (error) {
      logger.error(error);
    }
  });

  DisputeModule.configure(bot);

  bot.command('freezeorder', adminMiddleware, async (ctx: MainContext) => {
    try {
      const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;

      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;

      const order = await Order.findOne({ _id: orderId });

      if (!order) return;

      // We check if this is a solver, the order must be from the same community
      if (!ctx.admin.admin) {
        if (!order.community_id) {
          return await messages.notAuthorized(ctx);
        }

        if (order.community_id != ctx.admin.default_community_id) {
          return await messages.notAuthorized(ctx);
        }
      }

      order.is_frozen = true;
      order.status = 'FROZEN';
      order.action_by = ctx.admin._id;
      await order.save();

      if (order.secret) await settleHoldInvoice({ secret: order.secret });

      await ctx.reply(ctx.i18n.t('order_frozen'));
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('cancelorder', adminMiddleware, async (ctx: MainContext) => {
    try {
      const validatedParams = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;
      if (validatedParams == null) return;
      const [orderId] = validatedParams;

      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;
      const order = await Order.findOne({ _id: orderId });

      if (order === null) return;

      // We look for a dispute for this order
      const dispute = await Dispute.findOne({ order_id: order._id });

      // We check if this is a solver, the order must be from the same community
      if (!ctx.admin.admin) {
        if (!order.community_id) {
          logger.debug(
            `cancelorder ${order._id}: The order is not in a community`
          );
          return await messages.notAuthorized(ctx);
        }

        if (order.community_id != ctx.admin.default_community_id) {
          logger.debug(
            `cancelorder ${order._id}: The community and the default user community are not the same`
          );
          return await messages.notAuthorized(ctx);
        }

        // We check if this dispute is from a community we validate that
        // the solver is running this command
        if (dispute && dispute.solver_id != ctx.admin._id) {
          logger.debug(
            `cancelorder ${order._id}: @${ctx.admin.username} is not the solver of this dispute`
          );
          return await messages.notAuthorized(ctx);
        }
      }

      if (order.hash) await cancelHoldInvoice({ hash: order.hash });

      if (dispute) {
        dispute.status = 'SELLER_REFUNDED';
        await dispute.save();
      }

      logger.info(`order ${order._id}: cancelled by admin`);

      order.status = 'CANCELED_BY_ADMIN';
      order.canceled_by = ctx.admin._id;
      await order.save();
      order.status = 'CANCELED';
      OrderEvents.orderUpdated(order);
      const buyer = await User.findOne({ _id: order.buyer_id });
      const seller = await User.findOne({ _id: order.seller_id });
      if (buyer === null || seller === null) throw Error("buyer and/or seller were not found in DB");
      // we sent a private message to the admin
      await messages.successCancelOrderMessage(ctx, ctx.admin, order, ctx.i18n);
      // we sent a private message to the seller
      await messages.successCancelOrderByAdminMessage(ctx, bot, seller, order);
      // we sent a private message to the buyer
      await messages.successCancelOrderByAdminMessage(ctx, bot, buyer, order);
    } catch (error) {
      logger.error(error);
    }
  });

  // We allow users cancel pending orders,
  // pending orders are the ones that are not taken by another user
  bot.command('cancel', userMiddleware, async (ctx: CommunityContext) => {
    try {
      if (!('message' in ctx.update) || !('text' in ctx.update.message)){
        throw new Error(ctxUpdateAssertMsg);
      }
      const params = ctx.update.message.text.split(' ');
      const [command, orderId] = params.filter((el: string) => el);

      if (!orderId) {
        const orders = await askForConfirmation(ctx.user, command);
        if (orders === null || orders.length === 0) return await ctx.reply(`${command}  <order Id>`);

        return await messages.showConfirmationButtons(ctx, orders, command);
      } else if (!(await validateObjectId(ctx, orderId))) {
        // eslint-disable-next-line no-useless-return
        return;
      } else {
        await cancelOrder(ctx, orderId, ctx.user);
      }
    } catch (error) {
      logger.error(error);
    }
  });

  // We allow users cancel all pending orders,
  // pending orders are the ones that are not taken by another user
  bot.command('cancelall', userMiddleware, async (ctx: CommunityContext) => {
    try {
      const pending_orders = await ordersActions.getOrders(ctx.user, 'PENDING') || [];
      const seller_orders = await ordersActions.getOrders(ctx.user, 'WAITING_BUYER_INVOICE') || [];
      const buyer_orders = await ordersActions.getOrders(ctx.user, 'WAITING_PAYMENT') || [];

      const orders = [...pending_orders, ...seller_orders, ...buyer_orders];

      if (orders.length === 0) {
        return await messages.notOrdersMessage(ctx);
      };

      for (const order of orders) {

        // If a buyer is taking a sell offer and accidentally touch continue button we
        // let the user to cancel
        if (order.type === 'sell' && order.status === 'WAITING_BUYER_INVOICE') {
          return await cancelAddInvoice(ctx, order);
        }

        // If a seller is taking a buy offer and accidentally touch continue button we
        // let the user to cancel
        if (order.type === 'buy' && order.status === 'WAITING_PAYMENT') {
          return await cancelShowHoldInvoice(ctx, order);
        }
        
        // If a buyer wants cancel but the seller already pay the hold invoice
        if (order.type === 'buy' && order.status === 'WAITING_BUYER_INVOICE') {
          if (order.hash) await cancelHoldInvoice({ hash: order.hash });        
        }
          
        order.status = 'CANCELED';
        order.canceled_by = ctx.user.id;
        await order.save();
        OrderEvents.orderUpdated(order);
        // We delete the messages related to that order from the channel
        await deleteOrderFromChannel(order, bot.telegram);
      }
      // we sent a private message to the user
      await messages.successCancelAllOrdersMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('settleorder', adminMiddleware, async (ctx: CommunityContext) => {
    try {
      const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;

      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;

      const order = await Order.findOne({ _id: orderId });
      if (order === null) return;

       // Check if the order status is already PAID_HOLD_INVOICE
      if (order.status === 'PAID_HOLD_INVOICE') {
      await ctx.reply(ctx.i18n.t('order_already_settled'));
      return;
      }

      // We look for a dispute for this order
      const dispute = await Dispute.findOne({ order_id: order._id });

      // We check if this is a solver, the order must be from the same community
      if (!ctx.admin.admin) {
        if (!order.community_id) {
          return await messages.notAuthorized(ctx);
        }

        if (order.community_id != ctx.admin.default_community_id) {
          return await messages.notAuthorized(ctx);
        }

        // We check if this dispute is from a community we validate that
        // the solver is running this command
        if (dispute && dispute.solver_id != ctx.admin.id) {
          return await messages.notAuthorized(ctx);
        }
      }

      if (order.secret) await settleHoldInvoice({ secret: order.secret });

      if (dispute) {
        dispute.status = 'SETTLED';
        await dispute.save();
      }

      order.status = 'COMPLETED_BY_ADMIN';
      await order.save();
      const buyer = await User.findOne({ _id: order.buyer_id });
      const seller = await User.findOne({ _id: order.seller_id });
      if (buyer === null || seller === null) throw Error("buyer and/or seller were not found in DB");
      // we sent a private message to the admin
      await messages.successCompleteOrderMessage(ctx, order);
      // we sent a private message to the seller
      await messages.successCompleteOrderByAdminMessage(
        ctx,
        bot,
        seller,
        order
      );
      // we sent a private message to the buyer
      await messages.successCompleteOrderByAdminMessage(ctx, bot, buyer, order);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('checkorder', superAdminMiddleware, async (ctx: MainContext) => {
    try {
      const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;
      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;
      const order = await Order.findOne({ _id: orderId });

      if (order === null) return;

      const buyer = await User.findOne({ _id: order.buyer_id });
      const seller = await User.findOne({ _id: order.seller_id });
      if (buyer === null || seller === null) throw Error("buyer and/or seller were not found in DB");
      await messages.checkOrderMessage(ctx, order, buyer, seller);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('checkinvoice', superAdminMiddleware, async (ctx: MainContext) => {
    try {
      const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;
      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;
      const order = await Order.findOne({ _id: orderId });

      if (order === null) return;
      if (!order.hash) return;

      const invoice = await getInvoice({ hash: order.hash });

      await messages.checkInvoiceMessage(
        ctx,
        invoice.is_confirmed,
        invoice.is_canceled,
        invoice.is_held
      );
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('resubscribe', superAdminMiddleware, async (ctx: MainContext) => {
    try {
      const [hash] = (await validateParams(ctx, 2, '\\<_hash_\\>'))!;

      if (!hash) return;

      const order = await Order.findOne({ hash });

      if (order === null) return;
      await subscribeInvoice(bot, hash, true);
      ctx.reply(`hash resubscribed`);
    } catch (error: any) {
      logger.error(`/resubscribe command error: ${error.toString()}`);
    }
  });

  bot.command('help', userMiddleware, async (ctx: MainContext) => {
    try {
      await messages.helpMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('disclaimer', userMiddleware, async (ctx: MainContext) => {
    try {
      await messages.disclaimerMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });
  
    bot.command('privacy', userMiddleware, async (ctx: MainContext) => {
    try {
      await messages.privacyMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  // Only buyers can use this command
  bot.command('fiatsent', userMiddleware, async (ctx: MainContext) => {
    try {
      if (!('message' in ctx.update) || !('text' in ctx.update.message)){
        throw new Error(ctxUpdateAssertMsg);
      }
      const params = ctx.update.message.text.split(' ');
      const [command, orderId] = params.filter((el: string) => el);

      if (!orderId) {
        const orders = await askForConfirmation(ctx.user, command);
        if (orders === null || orders.length === 0) return await ctx.reply(`${command} <order Id>`);

        return await messages.showConfirmationButtons(ctx, orders, command);
      } else if (!(await validateObjectId(ctx, orderId))) {
        // eslint-disable-next-line no-useless-return
        return;
      } else {
        await fiatSent(ctx, orderId, ctx.user);
      }
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('ban', adminMiddleware, async (ctx: MainContext) => {
    try {
      let [username] = (await validateParams(
        ctx,
        2,
        '\\<_username or telegram ID_\\>'
      ))!;

      if (!username) return;

      username = removeAtSymbol(username);
      const user = await User.findOne({
        $or: [{ username }, { tg_id: username }],
      });
      if (user === null) {
        await messages.notFoundUserMessage(ctx);
        return;
      }

      // We check if this is a solver, we ban the user only in the default community of the solver
      if (!ctx.admin.admin) {
        if (ctx.admin.default_community_id) {
          const community = await Community.findById(
            ctx.admin.default_community_id
          );
          if (community === null) throw Error("Community was not found in DB");
          community.banned_users.push({
            id: user._id,
            username: user.username,
          });
          await community.save();
        } else {
          return await ctx.reply(ctx.i18n.t('need_default_community'));
        }
      } else {
        user.banned = true;
        await user.save();
      }
      await messages.userBannedMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('unban', adminMiddleware, async (ctx: MainContext) => {
    try {
      let [username] = (await validateParams(
        ctx,
        2,
        '\\<_username or telegram ID_\\>'
      ))!;

      if (!username) return;

      username = removeAtSymbol(username);
      const user = await User.findOne({
        $or: [{ username }, { tg_id: username }],
      });
      if (user === null) {
        await messages.notFoundUserMessage(ctx);
        return;
      }

      // We check if this is a solver, we unban the user only in the default community of the solver
      if (!ctx.admin.admin) {
        if (ctx.admin.default_community_id) {
          const community = await Community.findById(
            ctx.admin.default_community_id
          );
          if (community === null) throw Error("Community was not found in DB");
          community.banned_users = community.banned_users.toObject().filter(
            (el: IUsernameId) => el.id !== user.id
          );
          await community.save();
        } else {
          return await ctx.reply(ctx.i18n.t('need_default_community'));
        }
      } else {
        user.banned = false;
        await user.save();
      }
      await messages.userUnBannedMessage(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('setaddress', userMiddleware, async (ctx: MainContext) => {
    try {
      const [lightningAddress] = (await validateParams(
        ctx,
        2,
        '\\<_lightningAddress / off_\\>'
      ))!;
      if (!lightningAddress) return;

      if (lightningAddress === 'off') {
        ctx.user.lightning_address = null;
        await ctx.user.save();
        return await messages.disableLightningAddress(ctx);
      }

      if (!(await validateLightningAddress(lightningAddress)))
        return await messages.invalidLightningAddress(ctx);

      ctx.user.lightning_address = lightningAddress;
      await ctx.user.save();
      await messages.successSetAddress(ctx);
    } catch (error) {
      logger.error(error);
    }
  });

  // Only buyers can use this command
  bot.command('setinvoice', userMiddleware, async (ctx: MainContext) => {
    try {
      const command = '/setinvoice';
      const orders = await askForConfirmation(ctx.user, command);
      if (orders === null || !orders.length) return await ctx.reply(ctx.i18n.t('setinvoice_no_response'));

      return await messages.showConfirmationButtons(ctx, orders, command);
    } catch (error) {
      logger.error(error);
    }
  });

  OrdersModule.configure(bot);

  bot.action('addInvoiceBtn', userMiddleware, async (ctx: CommunityContext) => {
    await addInvoice(ctx, bot);
  });

  bot.action('cancelAddInvoiceBtn', userMiddleware, async (ctx: CommunityContext) => {
    await cancelAddInvoice(ctx);
  });

  bot.action('showHoldInvoiceBtn', userMiddleware, async (ctx: CommunityContext) => {
    await showHoldInvoice(ctx, bot);
  });

  bot.action('cancelShowHoldInvoiceBtn', userMiddleware, async (ctx: CommunityContext) => {
    await cancelShowHoldInvoice(ctx);
  });

  bot.action(/^showStarBtn\(([1-5]),(\w{24})\)$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    await rateUser(ctx, bot, Number(ctx.match[1]), ctx.match[2]);
  });

  bot.action(/^addInvoicePHIBtn_([0-9a-f]{24})$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    await addInvoicePHI(ctx, bot, ctx.match[1]);
  });

  bot.action(/^setinvoice_([0-9a-f]{24})$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    ctx.deleteMessage();
    await addInvoicePHI(ctx, bot, ctx.match[1]);
  });

  bot.action(/^cancel_([0-9a-f]{24})$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    ctx.deleteMessage();
    await cancelOrder(ctx, ctx.match[1]);
  });

  bot.action(/^fiatsent_([0-9a-f]{24})$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    ctx.deleteMessage();
    await fiatSent(ctx, ctx.match[1]);
  });

  bot.action(/^release_([0-9a-f]{24})$/, userMiddleware, async (ctx: CommunityContext) => {
    if (ctx.match === null) {
      throw new Error("ctx.match should not be null");
    }
    ctx.deleteMessage();
    await release(ctx, ctx.match[1]);
  });

  bot.command('paytobuyer', adminMiddleware, async (ctx: MainContext) => {
    try {
      const [orderId] = (await validateParams(ctx, 2, '\\<_order id_\\>'))!;
      if (!orderId) return;
      if (!(await validateObjectId(ctx, orderId))) return;
      const order = await Order.findOne({
        _id: orderId,
      });
      if (!order) return await messages.notActiveOrderMessage(ctx);
      
      // We check if this is a solver, the order must be from the same community
      if (!ctx.admin.admin) {
        if (!order.community_id) {
          return await messages.notAuthorized(ctx);
        }

        if (order.community_id != ctx.admin.default_community_id) {
          return await messages.notAuthorized(ctx);
        }
      }

      // We make sure the buyers invoice is not being paid
      const isPending = await PendingPayment.findOne({
        order_id: order._id,
        attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
      });

      if (isPending) return;

      await payToBuyer(bot, order);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('listcurrencies', userMiddleware, async (ctx: MainContext) => {
    try {
      const currencies = getCurrenciesWithPrice();

      await messages.listCurrenciesResponse(ctx, currencies);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('info', userMiddleware, async (ctx: MainContext) => {
    try {
      const config = await Config.findOne({});
      if (config === null) throw Error("Config was not found in DB");
      await messages.showInfoMessage(ctx, ctx.user, config);
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('showusername', userMiddleware, async (ctx: MainContext) => {
    try {
      const [showString] = (await validateParams(ctx, 2, '_yes/no_'))!;
      if (!showString) return;
      const show = showString === 'yes';
      ctx.user.show_username = show;
      await ctx.user.save();
      messages.updateUserSettingsMessage(ctx, 'showusername', String(show));
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('showvolume', userMiddleware, async (ctx: MainContext) => {
    try {
      const [showString] = (await validateParams(ctx, 2, '_yes/no_'))!;
      if (!showString) return;
      const show = showString === 'yes';
      ctx.user.show_volume_traded = show;
      await ctx.user.save();
      messages.updateUserSettingsMessage(ctx, 'showvolume', String(show));
    } catch (error) {
      logger.error(error);
    }
  });

  bot.command('exit', userMiddleware, async (ctx: MainContext) => {
    try {
      if (ctx.message?.chat.type !== 'private') return;

      await ctx.reply(ctx.i18n.t('not_wizard'));
    } catch (error) {
      logger.error(error);
    }
  });

  bot.on('text', userMiddleware, async (ctx: MainContext) => {
    try {
      if (ctx.message?.chat.type !== 'private') return;

      const text = (ctx.message as Message.TextMessage).text;
      let message;
      // If the user is trying to enter a command with first letter uppercase
      if (text[0] === '/' && text[1] === text[1].toUpperCase()) {
        message = ctx.i18n.t('no_capital_letters');
      } else {
        message = ctx.i18n.t('unknown_command');
      }
      ctx.reply(message);
    } catch (error) {
      logger.error(error);
    }
  });

  return bot;
};

const start = (botToken: string, options: Partial<Telegraf.Options<CommunityContext>>): Telegraf<CommunityContext> => {
  const bot = initialize(botToken, options);

  bot.launch();

  logger.notice('Bot launched.');

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
};

export { initialize, start };
