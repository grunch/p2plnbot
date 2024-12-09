import { Order, Community } from '../models';
import * as messages from './messages';
import { getCurrency, numberFormat, getBtcExchangePrice, getFee, getUserAge, getStars } from '../util';
import { logger } from '../logger';
import { I18nContext } from '@grammyjs/i18n';
import { UserDocument } from '../models/user';
import { HasTelegram, MainContext } from './start';
import { IOrder } from '../models/order';
import { IFiat } from '../util/fiatModel';
import * as OrderEvents from './modules/events/orders';

const { ObjectId } = require('mongoose').Types;

interface CreateOrderArguments {
  type: string;
  amount: number;
  fiatAmount: number[];
  fiatCode: string;
  paymentMethod: string;
  status: string;
  priceMargin: any; // ?
  range_parent_id?: string;
  tgChatId?: string;
  tgOrderMessage?: string;
  community_id: string;
}

interface BuildDescriptionArguments {
  user: UserDocument;
  type: string;
  amount: number;
  fiatAmount: number[];
  fiatCode: string;
  paymentMethod: string;
  priceMargin: any; // ?
  priceFromAPI: boolean;
  currency: IFiat;
}

interface FiatAmountData {
  fiat_amount?: number;
  min_amount?: number;
  max_amount?: number;
}

const createOrder = async (
  i18n: I18nContext,
  bot: HasTelegram,
  user: UserDocument,
  {
    type,
    amount,
    fiatAmount,
    fiatCode,
    paymentMethod,
    status,
    priceMargin,
    range_parent_id,
    tgChatId,
    tgOrderMessage,
    community_id,
  }: CreateOrderArguments
) => {
  try {
    amount = Math.floor(amount);
    let isPublic = true;
    if (community_id) {
      const community = await Community.findById(community_id);
      if(community == null)
        throw new Error("community is null");
      isPublic = community.public;
    }
    const fee = await getFee(amount, community_id);
    if(process.env.MAX_FEE === undefined)
      throw new Error("Environment variable MAX_FEE is not defined");
    if(process.env.FEE_PERCENT === undefined)
      throw new Error("Environment variable FEE_PERCENT is not defined");
    // Global fee values at the moment of the order creation
    // We will need this to calculate the final amount
    const botFee = parseFloat(process.env.MAX_FEE);
    const communityFee = parseFloat(process.env.FEE_PERCENT);
    const currency = getCurrency(fiatCode);
    if(currency == null)
      throw new Error("currency is null");
    const priceFromAPI = !amount;

    if (priceFromAPI && !currency.price) {
      await messages.notRateForCurrency(bot, user, i18n);
      return;
    }

    const fiatAmountData = getFiatAmountData(fiatAmount);

    const baseOrderData = {
      ...fiatAmountData,
      amount,
      fee,
      bot_fee: botFee,
      community_fee: communityFee,
      creator_id: user._id,
      type,
      status,
      fiat_code: fiatCode,
      payment_method: paymentMethod,
      tg_chat_id: tgChatId,
      tg_order_message: tgOrderMessage,
      price_from_api: priceFromAPI,
      price_margin: priceMargin || 0,
      description: buildDescription(i18n, {
        user,
        type,
        amount,
        fiatAmount,
        fiatCode,
        paymentMethod,
        priceMargin,
        priceFromAPI,
        currency,
      }),
      range_parent_id,
      community_id,
      is_public: isPublic,
    };

    let order;

    if (type === 'sell') {
      order = new Order({
        seller_id: user._id,
        ...baseOrderData,
      });
    } else {
      order = new Order({
        buyer_id: user._id,
        ...baseOrderData,
      });
    }
    await order.save();

    if (order.status !== 'PENDING') {
      OrderEvents.orderUpdated(order);
    }

    return order;
  } catch (error) {
    logger.error(error);
  }
};

const getFiatAmountData = (fiatAmount: number[]) => {
  const response: FiatAmountData = {};
  if (fiatAmount.length === 2) {
    response.min_amount = fiatAmount[0];
    response.max_amount = fiatAmount[1];
  } else {
    response.fiat_amount = fiatAmount[0];
  }

  return response;
};

const buildDescription = (
  i18n: I18nContext,
  {
    user,
    type,
    amount,
    fiatAmount,
    fiatCode,
    paymentMethod,
    priceMargin,
    priceFromAPI,
    currency,
  } : BuildDescriptionArguments
) => {
  try {
    const action = type === 'sell' ? i18n.t('selling') : i18n.t('buying');
    const hashtag = `#${type.toUpperCase()}${fiatCode}\n`;
    const paymentAction =
      type === 'sell' ? i18n.t('receive_payment') : i18n.t('pay');
    const trades = user.trades_completed;
    const volume = numberFormat(fiatCode, user.volume_traded);
    const totalRating = user.total_rating;
    const totalReviews = user.total_reviews;
    const username = user.show_username
      ? `@${user.username} ` + i18n.t('is') + ` `
      : ``;
    const volumeTraded = user.show_volume_traded
      ? i18n.t('trading_volume', { volume }) + `\n`
      : ``;
    priceMargin =
      !!priceMargin && priceMargin > 0 ? `+${priceMargin}` : priceMargin;
    const priceMarginText = priceMargin ? `${priceMargin}%` : ``;

    const fiatAmountString = fiatAmount
      .map(amt => numberFormat(fiatCode, amt))
      .join(' - ');

    let currencyString = `${fiatCode} ${fiatAmountString}`;

    if (currency)
      currencyString = `${fiatAmountString} ${currency.code} ${currency.emoji}`;

    let amountText = `${numberFormat(fiatCode, amount)} `;
    let tasaText = '';
    if (priceFromAPI) {
      amountText = '';
      tasaText =
        i18n.t('rate') + `: ${process.env.FIAT_RATE_NAME} ${priceMarginText}\n`;
    } else {
      const exchangePrice = getBtcExchangePrice(fiatAmount[0], amount);
      if (exchangePrice == null)
        throw new Error("exchangePrice is null");
      tasaText =
        i18n.t('price') +
        `: ${numberFormat(fiatCode, Number(exchangePrice.toFixed(2)))}\n`;
    }

    let rateText = '\n';
    if (totalRating) {
      rateText = getStars(totalRating, totalReviews) + '\n';
    }

    const ageInDays = getUserAge(user);

    let description =
      `${username}${action} ${amountText}` + i18n.t('sats') + `\n`;
    description += i18n.t('for') + ` ${currencyString}\n`;
    description += `${paymentAction} ` + i18n.t('by') + ` ${paymentMethod}\n`;
    description += i18n.t('has_successful_trades', { trades }) + `\n`;
    description += i18n.t('user_age', { days: ageInDays }) + `\n`;
    description += volumeTraded;
    description += hashtag;
    description += tasaText;
    description += rateText;

    return description;
  } catch (error) {
    logger.error(error);
  }
};

const getOrder = async (ctx: MainContext, user: UserDocument, orderId: string) => {
  try {
    if (!ObjectId.isValid(orderId)) {
      await messages.notValidIdMessage(ctx);
      return false;
    }

    const where = {
      _id: orderId,
      $or: [{ seller_id: user._id }, { buyer_id: user._id }],
    };

    const order = await Order.findOne(where);
    if (!order) {
      await messages.notOrderMessage(ctx);
      return false;
    }

    return order;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const getOrders = async (user: UserDocument, status?: string) => {
  try {
    const where: any = {
      $and: [
        {
          $or: [{ buyer_id: user._id }, { seller_id: user._id }],
        },
      ],
    };

    if (status) {
      where.$and.push({ status });
    } else {
      const $or = [
        { status: 'WAITING_PAYMENT' },
        { status: 'WAITING_BUYER_INVOICE' },
        { status: 'PENDING' },
        { status: 'ACTIVE' },
        { status: 'FIAT_SENT' },
        { status: 'PAID_HOLD_INVOICE' },
        { status: 'DISPUTE' },
      ];
      where.$and.push({ $or });
    }

    return await Order.find(where);
  } catch (error) {
    logger.error(error);
  }
};

const getNewRangeOrderPayload = async (order: IOrder) => {
  try {
    let newMaxAmount = 0;

    if (order.max_amount !== undefined && order.fiat_amount !== undefined) {
      newMaxAmount = order.max_amount - order.fiat_amount;
    }

    if (newMaxAmount >= order.min_amount) {
      const orderData = {
        type: order.type,
        amount: 0,
        // drop newMaxAmount if it is equal to min_amount and create a
        // not range order.
        // Set preserves insertion order, so min_amount will be always
        // before newMaxAmount
        fiatAmount: [...new Set([order.min_amount, newMaxAmount])],
        fiatCode: order.fiat_code,
        paymentMethod: order.payment_method,
        status: 'PENDING',
        priceMargin: order.price_margin,
        range_parent_id: order._id,
        tgChatId: order.tg_chat_id,
        tgOrderMessage: order.tg_order_message,
        community_id: order.community_id,
      };

      return orderData;
    }
  } catch (error) {
    logger.error(error);
  }
};

export {
  createOrder,
  getOrder,
  getOrders,
  getNewRangeOrderPayload,
};
