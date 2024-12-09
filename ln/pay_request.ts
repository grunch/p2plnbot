import {
  payViaPaymentRequest,
  getPayment,
  deleteForwardingReputations,
  AuthenticatedLnd,
} from 'lightning';
import { User, PendingPayment } from '../models';
import lnd from './connect';
import { handleReputationItems, getUserI18nContext } from '../util';
import * as messages from '../bot/messages';
import { logger } from '../logger';
import * as OrderEvents from '../bot/modules/events/orders';
import { IOrder } from '../models/order';
import { HasTelegram } from '../bot/start';

const { parsePaymentRequest } = require('invoices');

interface PayViaPaymentRequestParams {
  lnd: AuthenticatedLnd;
  request: string;
  pathfinding_timeout: number;
  tokens?: number;
  max_fee?: number;
}

const payRequest = async ({ request, amount }: { request: string, amount: number }) => {
  try {
    const invoice = parsePaymentRequest({ request });
    if (!invoice) return false;
    // If the invoice is expired we return is_expired = true
    if (invoice.is_expired) return invoice;

    const maxRoutingFee = process.env.MAX_ROUTING_FEE;
    if (maxRoutingFee === undefined)
      throw new Error("Environment variable MAX_ROUTING_FEE is not defined");
    // We need to set a max fee amount
    const maxFee = amount * parseFloat(maxRoutingFee);

    const params : PayViaPaymentRequestParams = {
      lnd,
      request,
      pathfinding_timeout: 60000,
    };
    // If the invoice doesn't have amount we add it to the params
    if (!invoice.tokens) params.tokens = amount;
    // We set the max fee
    params.max_fee = maxFee;
    // If the amount is small we use a different max routing fee
    if (amount <= 100) params.max_fee = amount * 0.1;

    // Delete all routing reputations to clear pathfinding memory
    await deleteForwardingReputations({ lnd });

    const payment = await payViaPaymentRequest(params);

    return payment;
  } catch (error) {
    logger.error(`payRequest: ${error}`);
    return false;
  }
};

const payToBuyer = async (bot: HasTelegram, order: IOrder) => {
  try {
    // We check if the payment is on flight we don't do anything
    const isPending = await isPendingPayment(order.buyer_invoice);
    if (isPending) {
      return;
    }
    const payment = await payRequest({
      request: order.buyer_invoice,
      amount: order.amount,
    });
    const buyerUser = await User.findOne({ _id: order.buyer_id });
    if (buyerUser === null)
      throw new Error("buyerUser was not found");
    // If the buyer's invoice is expired we let it know and don't try to pay again
    const i18nCtx = await getUserI18nContext(buyerUser);
    if (!!payment && payment.is_expired) {
      await messages.expiredInvoiceOnPendingMessage(
        bot,
        buyerUser,
        order,
        i18nCtx
      );
      return;
    }
    const sellerUser = await User.findOne({ _id: order.seller_id });
    if (sellerUser === null)
      throw new Error("sellerUser was not found");
    if (!!payment && !!payment.confirmed_at) {
      logger.info(`Order ${order._id} - Invoice with hash: ${payment.id} paid`);
      order.status = 'SUCCESS';
      order.routing_fee = payment.fee;

      await order.save();
      OrderEvents.orderUpdated(order);
      await handleReputationItems(buyerUser, sellerUser, order.amount);
      await messages.buyerReceivedSatsMessage(
        bot,
        buyerUser,
        sellerUser,
        i18nCtx
      );
      await messages.rateUserMessage(bot, buyerUser, order, i18nCtx);
    } else {
      await messages.invoicePaymentFailedMessage(bot, buyerUser, i18nCtx);
      const pp = new PendingPayment({
        amount: order.amount,
        payment_request: order.buyer_invoice,
        user_id: buyerUser._id,
        description: order.description,
        hash: order.hash,
        order_id: order._id,
      });
      await pp.save();
    }
  } catch (error) {
    logger.error(`payToBuyer catch: ${error}`);
  }
};

const isPendingPayment = async (request: string) => {
  try {
    const { id } = parsePaymentRequest({ request });
    const { is_pending } = await getPayment({ lnd, id });

    return !!is_pending;
  } catch (error: any) {
    const message = error.toString();
    logger.error(`isPendingPayment catch error: ${message}`);
    return false;
  }
};

export {
  payRequest,
  payToBuyer,
  isPendingPayment,
};
