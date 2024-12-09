import { HasTelegram, MainContext, OrderQuery, ctxUpdateAssertMsg } from "./start";
import { IUsernameId } from "../models/community";
import { FilterQuery } from "mongoose";
import { UserDocument } from "../models/user";
import { IOrder } from "../models/order";

import * as messages from './messages';
import { Order, User, Community } from '../models';
import { isIso4217, isDisputeSolver, removeLightningPrefix, isOrderCreator } from '../util';
import { existLightningAddress } from '../lnurl/lnurl-pay';
import { logger } from '../logger';

const { parsePaymentRequest } = require('invoices');
const { ObjectId } = require('mongoose').Types;

const ctxUpdateMessageFromAssertMsg = "ctx.update.message.from is not available";

// We look in database if the telegram user exists,
// if not, it creates a new user
const validateUser = async (ctx: MainContext, start: boolean) => {
  try {
    let tgUser = null;
    if (("callback_query" in ctx.update) && ctx.update.callback_query) {
      tgUser = ctx.update.callback_query.from;
    }
    else if (("message" in ctx.update) && ctx.update.message) {
      tgUser = ctx.update.message.from;
    }
    else {
      throw new Error(ctxUpdateAssertMsg);
    }
    // We need to make sure the user has a username
    if (!tgUser.username) {
      await ctx.telegram.sendMessage(tgUser.id, ctx.i18n.t('non_handle_error'));

      return false;
    }
    let user = await User.findOne({ tg_id: tgUser.id });

    if (!user && start) {
      user = new User({
        tg_id: tgUser.id,
        username: tgUser.username,
        lang: ctx.i18n.locale(),
      });
      await user.save();
    } else if (!user) {
      return false;
    } else if (user.banned) {
      await messages.bannedUserErrorMessage(ctx, user);

      return false;
    }
    if (tgUser.username !== user.username) {
      user.username = tgUser.username;
      await user.save();
    }

    return user;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateSuperAdmin = async (ctx: MainContext, id?: string) => {
  try {
    let tgUserId = id;
    if (!tgUserId) {
      if (!('message' in ctx.update) || !('from' in ctx.update.message)) {
        throw new Error(ctxUpdateMessageFromAssertMsg);
      }
      tgUserId = ctx.update.message.from.id.toString();
    }
    const user = await User.findOne({ tg_id: tgUserId });
    // If the user never started the bot we can't send messages
    // to that user, so we do nothing
    if (user === null) return;

    if (!user.admin) return await messages.notAuthorized(ctx, tgUserId);

    return user;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateAdmin = async (ctx: MainContext, id?: string) => {
  try {
    let tgUserId = id;
    if (!tgUserId) {
      if (!('message' in ctx.update) || !('from' in ctx.update.message)) {
        throw new Error(ctxUpdateMessageFromAssertMsg);
      }
      tgUserId = ctx.update.message.from.id.toString();
    }
    const user = await User.findOne({ tg_id: tgUserId });
    // If the user never started the bot we can't send messages
    // to that user, so we do nothing
    if (user === null) return;

    let community = null;
    if (user.default_community_id)
      community = await Community.findOne({ _id: user.default_community_id });
    
    const isSolver = isDisputeSolver(community, user);

    // TODO this validation does not return anything
    if (!user.admin && !isSolver)
      return await messages.notAuthorized(ctx, tgUserId);

    return user;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const processParameters = (args: string[]) => {
  const correctedArgs = [];
  let isGrouping = false;
  let groupedString = '';

  args.forEach((arg, _) => {
    if (arg.startsWith('“') && !isGrouping) {
      // Starts a new group, removing the incorrect quotation mark
      groupedString = arg.substring(1);
      isGrouping = true;
    } else if (arg.endsWith('”') && isGrouping) {
      // Closes the current group, removing the incorrect quotation mark and adding to the corrected array
      groupedString += ' ' + arg.slice(0, -1);
      correctedArgs.push(groupedString);
      isGrouping = false;
    } else if (isGrouping) {
      // Continues grouping the elements
      groupedString += ' ' + arg;
    } else {
      // Directly adds items that are outside a group
      correctedArgs.push(arg);
    }
  });

  // Handles the case when a group does not close properly
  if (isGrouping) {
    correctedArgs.push(groupedString);
  }

  return correctedArgs;
};

const validateSellOrder = async (ctx: MainContext) => {
  try {
    let args = ctx.state.command.args;
    if (args.length < 4) {
      await messages.sellOrderCorrectFormatMessage(ctx);
      return false;
    }
    args = processParameters(args);

    let [amount, fiatAmount, fiatCode, paymentMethod, priceMargin] = args;

    if (priceMargin && isNaN(priceMargin)) {
      await ctx.reply(
        ctx.i18n.t('must_be_numeric', {
          fieldName: ctx.i18n.t('premium_discount'),
        })
      );
      return false;
    }

    amount = parseInt(amount);
    if (isNaN(amount)) {
      await ctx.reply(
        ctx.i18n.t('must_be_int', { fieldName: ctx.i18n.t('sats_amount') })
      );

      return false;
    }

    // for ranges like 100--2, the result will be [100, 0, 2]
    fiatAmount = fiatAmount.split('-');
    fiatAmount = fiatAmount.map(Number);

    if (fiatAmount.length === 2 && amount) {
      await messages.invalidRangeWithAmount(ctx);
      return false;
    }

    // ranges like [100, 0, 2] (originate from ranges like 100--2)
    // will make this conditional fail
    if (fiatAmount.length > 2) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }
    
    // TODO, this validation could be amount > 0?
    if (amount !== 0 && amount < Number(process.env.MIN_PAYMENT_AMT)) {
      await messages.mustBeGreatherEqThan(
        ctx,
        'monto_en_sats',
        Number(process.env.MIN_PAYMENT_AMT)
      );
      return false;
    }

    if (fiatAmount.length === 2 && fiatAmount[1] <= fiatAmount[0]) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }

    if (fiatAmount.some(isNaN)) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }

    if (fiatAmount.some((x: number) => x < 1)) {
      await messages.mustBeGreatherEqThan(ctx, 'monto_en_fiat', 1);
      return false;
    }

    if (!isIso4217(fiatCode)) {
      await messages.mustBeValidCurrency(ctx);
      return false;
    }

    paymentMethod = paymentMethod.replace(/[&/\\#,+~%.'":*?<>{}]/g, '');

    return {
      amount,
      fiatAmount,
      fiatCode: fiatCode.toUpperCase(),
      paymentMethod,
      priceMargin,
    };
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateBuyOrder = async (ctx: MainContext) => {
  try {
    let args = ctx.state.command.args;
    if (args.length < 4) {
      await messages.buyOrderCorrectFormatMessage(ctx);
      return false;
    }
    args = processParameters(args);

    let [amount, fiatAmount, fiatCode, paymentMethod, priceMargin] = args;

    if (priceMargin && isNaN(priceMargin)) {
      await ctx.reply(
        ctx.i18n.t('must_be_numeric', {
          fieldName: ctx.i18n.t('premium_discount'),
        })
      );
      return false;
    }

    amount = parseInt(amount);
    if (isNaN(amount)) {
      await ctx.reply(
        ctx.i18n.t('must_be_int', { fieldName: ctx.i18n.t('sats_amount') })
      );
      return false;
    }

    // for ranges like 100--2, the result will be [100, 0, 2]
    fiatAmount = fiatAmount.split('-');
    fiatAmount = fiatAmount.map(Number);

    if (fiatAmount.length === 2 && amount) {
      await messages.invalidRangeWithAmount(ctx);
      return false;
    }

    // ranges like [100, 0, 2] (originate from ranges like 100--2)
    // will make this conditional fail
    if (fiatAmount.length > 2) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }

    if (amount !== 0 && amount < Number(process.env.MIN_PAYMENT_AMT)) {
      await messages.mustBeGreatherEqThan(
        ctx,
        'monto_en_sats',
        Number(process.env.MIN_PAYMENT_AMT)
      );
      return false;
    }

    if (fiatAmount.length === 2 && fiatAmount[1] <= fiatAmount[0]) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }

    if (fiatAmount.some(isNaN)) {
      await messages.mustBeANumberOrRange(ctx);
      return false;
    }

    if (fiatAmount.some((x: number) => x < 1)) {
      await messages.mustBeGreatherEqThan(ctx, 'monto_en_fiat', 1);
      return false;
    }

    if (!isIso4217(fiatCode)) {
      await messages.mustBeValidCurrency(ctx);
      return false;
    }

    paymentMethod = paymentMethod.replace(/[&/\\#,+~%.'":*?<>{}]/g, '');

    return {
      amount,
      fiatAmount,
      fiatCode: fiatCode.toUpperCase(),
      paymentMethod,
      priceMargin,
    };
  } catch (error) {
    logger.error(error);
    return false;
  }
};
const validateLightningAddress = async (lightningAddress: string) => {
  const pattern = /^[\w-.]+@(?:[\w-]+(?<!-)\.)+(?:[A-Za-z]{2,63})$/;
  const lnExists = await existLightningAddress(lightningAddress);

  return pattern.test(lightningAddress) && lnExists;
};

const validateInvoice = async (ctx: MainContext, lnInvoice: string) => {
  try {
    const checkedPrefixlnInvoice = removeLightningPrefix(lnInvoice);
    let invoice;
    try {
      invoice = parsePaymentRequest({ request: checkedPrefixlnInvoice });
    } catch (error) {
      return false;
    }
    const latestDate = new Date(
      Date.now() + Number(process.env.INVOICE_EXPIRATION_WINDOW)
    );
    if (!("MIN_PAYMENT_AMT" in process.env)) throw Error("MIN_PAYMENT_AMT not found, please check .env file");
    if (!!invoice.tokens && invoice.tokens < Number(process.env.MIN_PAYMENT_AMT)) {
      await messages.minimunAmountInvoiceMessage(ctx);
      return false;
    }

    if (new Date(invoice.expires_at) < latestDate) {
      await messages.minimunExpirationTimeInvoiceMessage(ctx);
      return false;
    }

    if (invoice.is_expired !== false) {
      await messages.expiredInvoiceMessage(ctx);
      return false;
    }

    if (!invoice.destination) {
      await messages.requiredAddressInvoiceMessage(ctx);
      return false;
    }

    if (!invoice.id) {
      await messages.requiredHashInvoiceMessage(ctx);
      return false;
    }

    return invoice;
  } catch (error) {
    logger.error(error);
    logger.debug(lnInvoice);
    return false;
  }
};

const isValidInvoice = async (ctx: MainContext, lnInvoice: string) => {
  try {
    const checkedPrefixlnInvoice = removeLightningPrefix(lnInvoice);
    const invoice = parsePaymentRequest({ request: checkedPrefixlnInvoice });
    const latestDate = new Date(
      Date.now() + Number(process.env.INVOICE_EXPIRATION_WINDOW)
    );
    if (!!invoice.tokens && invoice.tokens < Number(process.env.MIN_PAYMENT_AMT)) {
      await messages.invoiceMustBeLargerMessage(ctx);
      return {
        success: false,
      };
    }

    if (new Date(invoice.expires_at) < latestDate) {
      await messages.invoiceExpiryTooShortMessage(ctx);
      return {
        success: false,
      };
    }

    if (invoice.is_expired !== false) {
      await messages.invoiceHasExpiredMessage(ctx);
      return {
        success: false,
      };
    }

    if (!invoice.destination) {
      await messages.invoiceHasWrongDestinationMessage(ctx);
      return {
        success: false,
      };
    }

    if (!invoice.id) {
      await messages.requiredHashInvoiceMessage(ctx);
      return {
        success: false,
      };
    }

    return {
      success: true,
      invoice,
    };
  } catch (error) {
    await messages.invoiceInvalidMessage(ctx);
    return {
      success: false,
    };
  }
};


const validateTakeSellOrder = async (ctx: MainContext, bot: HasTelegram, user: UserDocument, order: IOrder | null) => {
  try {
    if (!order) {
      await messages.invalidOrderMessage(ctx, bot, user);
      return false;
    }

    if (isOrderCreator(user, order) && process.env.NODE_ENV === 'production') {
      await messages.cantTakeOwnOrderMessage(ctx, bot, user);
      return false;
    }

    if (order.type === 'buy') {
      await messages.invalidTypeOrderMessage(ctx, bot, user, order.type);
      return false;
    }

    if (order.status !== 'PENDING') {
      await messages.alreadyTakenOrderMessage(ctx, bot, user);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateTakeBuyOrder = async (ctx: MainContext, bot: HasTelegram, user: UserDocument, order: IOrder) => {
  try {
    if (!order) {
      await messages.invalidOrderMessage(ctx, bot, user);
      return false;
    }
    if (isOrderCreator(user, order) && process.env.NODE_ENV === 'production') {
      await messages.cantTakeOwnOrderMessage(ctx, bot, user);
      return false;
    }
    if (order.type === 'sell') {
      await messages.invalidTypeOrderMessage(ctx, bot, user, order.type);
      return false;
    }
    if (order.status !== 'PENDING') {
      await messages.alreadyTakenOrderMessage(ctx, bot, user);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateReleaseOrder = async (ctx: MainContext, user: UserDocument, orderId: string) => {
  try {
    let where: FilterQuery<OrderQuery> = {
      seller_id: user._id,
      status: 'WAITING_BUYER_INVOICE',
      _id: orderId,
    };
    let order = await Order.findOne(where);
    if (order) {
      await messages.waitingForBuyerOrderMessage(ctx);
      return false;
    }

    where = {
      $and: [
        { seller_id: user._id },
        {
          $or: [
            { status: 'ACTIVE' },
            { status: 'FIAT_SENT' },
            { status: 'DISPUTE' },
          ],
        },
      ],
    };

    if (orderId) {
      where._id = orderId;
    }
    order = await Order.findOne(where);

    if (order === null) {
      await messages.notActiveOrderMessage(ctx);
      return false;
    }

    return order;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateDisputeOrder = async (ctx: MainContext, user: UserDocument, orderId: string) => {
  try {
    const where = {
      $and: [
        { _id: orderId },
        { $or: [{ status: 'ACTIVE' }, { status: 'FIAT_SENT' }] },
        { $or: [{ seller_id: user._id }, { buyer_id: user._id }] },
      ],
    };

    const order = await Order.findOne(where);

    if (order === null) {
      await messages.notActiveOrderMessage(ctx);
      return false;
    }

    return order;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateFiatSentOrder = async (ctx: MainContext, user: UserDocument, orderId: string) => {
  try {
    const where: FilterQuery<OrderQuery> = {
      $and: [
        { buyer_id: user._id },
        { $or: [{ status: 'ACTIVE' }, { status: 'PAID_HOLD_INVOICE' }] },
      ],
    };

    if (orderId) {
      where._id = orderId;
    }
    const order = await Order.findOne(where);
    if (order === null) {
      await messages.notActiveOrderMessage(ctx);
      return false;
    }

    if (order.status === 'PAID_HOLD_INVOICE') {
      await messages.sellerPaidHoldMessage(ctx, user);
      return false;
    }

    if (!order.buyer_invoice) {
      await messages.notLightningInvoiceMessage(ctx, order);
      return false;
    }

    return order;
  } catch (error) {
    await messages.customMessage(ctx, '/fiatsent <order_id>');
    return false;
  }
};

// If a seller have an order with status FIAT_SENT, return false
const validateSeller = async (ctx: MainContext, user: UserDocument) => {
  try {
    const where = {
      seller_id: user._id,
      status: 'FIAT_SENT',
    };

    const order = await Order.findOne(where);

    if (order) {
      await messages.orderOnfiatSentStatusMessages(ctx, user);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateParams = async (ctx: MainContext, paramNumber: number, errOutputString: string): Promise<null | Array<string>> => {
  try {
    if (!('message' in ctx.update) || !('text' in ctx.update.message)) {
      throw new Error(ctxUpdateAssertMsg);
    }
    const paramsArray = ctx.update.message.text.split(' ');
    const params = paramsArray.filter((el: string) => el !== '');
    if (params.length !== paramNumber) {
      await messages.customMessage(
        ctx,
        `${params[0].toLowerCase()} ${errOutputString}`
      );

      return [];
    }

    return params.slice(1);
  } catch (error) {
    logger.error(error);
    return null;
  }
};

const validateObjectId = async (ctx: MainContext, id: string) => {
  try {
    if (!ObjectId.isValid(id)) {
      await messages.notValidIdMessage(ctx);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const validateUserWaitingOrder = async (ctx: MainContext, bot: MainContext, user: UserDocument) => {
  try {
    // If is a seller
    let where: FilterQuery<OrderQuery> = {
      seller_id: user._id,
      status: 'WAITING_PAYMENT',
    };
    let orders = await Order.find(where);
    if (orders.length > 0) {
      await messages.userCantTakeMoreThanOneWaitingOrderMessage(ctx, bot, user);
      return false;
    }
    // If is a buyer
    where = {
      buyer_id: user._id,
      status: 'WAITING_BUYER_INVOICE',
    };
    orders = await Order.find(where);
    if (orders.length > 0) {
      await messages.userCantTakeMoreThanOneWaitingOrderMessage(ctx, bot, user);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

// We check if the user is banned from the community in the order
const isBannedFromCommunity = async (user: UserDocument, communityId: string) => {
  try {
    if (!communityId) return false;
    const community = await Community.findOne({ _id: communityId });
    if (!community) return false;
    return community.banned_users.some((buser: IUsernameId) => buser.id == user._id);
  } catch (error) {
    logger.error(error);
    return false;
  }
};

export {
  validateSellOrder,
  validateBuyOrder,
  validateUser,
  validateAdmin,
  validateInvoice,
  validateTakeSellOrder,
  validateTakeBuyOrder,
  validateReleaseOrder,
  validateDisputeOrder,
  validateFiatSentOrder,
  validateSeller,
  validateParams,
  validateObjectId,
  validateLightningAddress,
  isValidInvoice,
  validateUserWaitingOrder,
  isBannedFromCommunity,
  validateSuperAdmin,
};
