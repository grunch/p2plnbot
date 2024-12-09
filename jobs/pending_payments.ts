import { PendingPayment, Order, User, Community } from '../models';
import * as messages from '../bot/messages';
import { logger } from "../logger";
import { Telegraf } from 'telegraf';
import { I18nContext } from '@grammyjs/i18n';
import { getUserI18nContext } from '../util';
import { CommunityContext } from '../bot/modules/community/communityContext';
import { orderUpdated } from '../bot/modules/events/orders';

const { payRequest, isPendingPayment } = require('../ln');

export const attemptPendingPayments = async (bot: Telegraf<CommunityContext>): Promise<void> => {
  const pendingPayments = await PendingPayment.find({
    paid: false,
    attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
    is_invoice_expired: false,
    community_id: null,
  });
  for (const pending of pendingPayments) {
    const order = await Order.findOne({ _id: pending.order_id });
    try {
      if (order === null) throw Error("Order was not found in DB");
      pending.attempts++;
      if (order.status === 'SUCCESS') {
        pending.paid = true;
        await pending.save();
        logger.info(`Order id: ${order._id} was already paid`);
        return;
      }
      // We check if the old payment is on flight
      const isPendingOldPayment: boolean = await isPendingPayment(order.buyer_invoice);

      // We check if this new payment is on flight
      const isPending: boolean = await isPendingPayment(pending.payment_request);

      // If one of the payments is on flight we don't do anything
      if (isPending || isPendingOldPayment) return;

      const payment = await payRequest({
        amount: pending.amount,
        request: pending.payment_request,
      });
      const buyerUser = await User.findOne({ _id: order.buyer_id });
      if (buyerUser === null) throw Error("buyerUser was not found in DB");
      const i18nCtx: I18nContext = await getUserI18nContext(buyerUser);
      // If the buyer's invoice is expired we let it know and don't try to pay again
      if (!!payment && payment.is_expired) {
        pending.is_invoice_expired = true;
        order.paid_hold_buyer_invoice_updated = false;
        return await messages.expiredInvoiceOnPendingMessage(
          bot,
          buyerUser,
          order,
          i18nCtx
        );
      }

      if (!!payment && !!payment.confirmed_at) {
        order.status = 'SUCCESS';
        order.routing_fee = payment.fee;
        pending.paid = true;
        pending.paid_at = new Date();
        // We add a new completed trade for the buyer
        buyerUser.trades_completed++;
        await buyerUser.save();
        // We add a new completed trade for the seller
        const sellerUser = await User.findOne({ _id: order.seller_id });
        if (sellerUser === null) throw Error("sellerUser was not found in DB");
        sellerUser.trades_completed++;
        sellerUser.save();
        logger.info(`Invoice with hash: ${pending.hash} paid`);
        await messages.toAdminChannelPendingPaymentSuccessMessage(
          bot,
          buyerUser,
          order,
          pending,
          payment,
          i18nCtx
        );
        await messages.toBuyerPendingPaymentSuccessMessage(
          bot,
          buyerUser,
          order,
          payment,
          i18nCtx
        );
        await messages.rateUserMessage(bot, buyerUser, order, i18nCtx);
      } else {
        if (
          process.env.PAYMENT_ATTEMPTS !== undefined &&
          pending.attempts === parseInt(process.env.PAYMENT_ATTEMPTS)
        ) {
          order.paid_hold_buyer_invoice_updated = false;
          await messages.toBuyerPendingPaymentFailedMessage(
            bot,
            buyerUser,
            order,
            i18nCtx
          );
        }
        await messages.toAdminChannelPendingPaymentFailedMessage(
          bot,
          buyerUser,
          order,
          pending,
          i18nCtx
        );
      }
    } catch (error: any) {
      const message: string = error.toString();
      logger.error(`attemptPendingPayments catch error: ${message}`);
    } finally {
      if (order !== null) {
        await order.save();
        orderUpdated(order);
      }
      await pending.save();
    }
  }
};

export const attemptCommunitiesPendingPayments = async (bot: Telegraf<CommunityContext>): Promise<void> => {
  const pendingPayments = await PendingPayment.find({
    paid: false,
    attempts: { $lt: process.env.PAYMENT_ATTEMPTS },
    is_invoice_expired: false,
    community_id: { $ne: null },
  });

  for (const pending of pendingPayments) {
    try {
      pending.attempts++;

      // We check if this new payment is on flight
      const isPending: boolean = await isPendingPayment(pending.payment_request);

      // If the payments is on flight we don't do anything
      if (isPending) return;

      const payment = await payRequest({
        amount: pending.amount,
        request: pending.payment_request,
      });
      const user = await User.findById(pending.user_id);
      if (user === null) throw Error("User was not found in DB");
      const i18nCtx: I18nContext = await getUserI18nContext(user);
      // If the buyer's invoice is expired we let it know and don't try to pay again
      if (!!payment && payment.is_expired) {
        pending.is_invoice_expired = true;
        await bot.telegram.sendMessage(
          user.tg_id,
          i18nCtx.t('invoice_expired_earnings')
        );
      }

      const community = await Community.findById(pending.community_id);
      if (community === null) throw Error("Community was not found in DB");
      if (!!payment && !!payment.confirmed_at) {
        pending.paid = true;
        pending.paid_at = new Date();

        // Reset the community's values
        community.earnings = 0;
        community.orders_to_redeem = 0;
        await community.save();
        logger.info(
          `Community ${community.id} withdrew ${pending.amount} sats, invoice with hash: ${payment.id} was paid`
        );
        await bot.telegram.sendMessage(
          user.tg_id,
          i18nCtx.t('pending_payment_success', {
            id: community.id,
            amount: pending.amount,
            paymentSecret: payment.secret,
          })
        );
      } else {
        if (
          process.env.PAYMENT_ATTEMPTS !== undefined &&
          pending.attempts === parseInt(process.env.PAYMENT_ATTEMPTS)
        ) {
          await bot.telegram.sendMessage(
            user.tg_id,
            i18nCtx.t('pending_payment_failed', {
              attempts: pending.attempts,
            })
          );
        }
        logger.error(
          `Community ${community.id}: Withdraw failed after ${pending.attempts} attempts, amount ${pending.amount} sats`
        );
      }
    } catch (error) {
      logger.error(`attemptCommunitiesPendingPayments catch error: ${error}`);
    } finally {
      await pending.save();
    }
  }
};
