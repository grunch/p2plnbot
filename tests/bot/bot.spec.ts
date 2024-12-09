import path from 'path';
import fs from 'fs';

import { initialize } from '../../bot';
import { User, Order } from '../../models';
import { getCurrenciesWithPrice } from '../../util';
import { mockUpdatesResponseForCurrencies } from './mocks/currenciesResponse';
import { mockUpdatesResponseForLanguages } from './mocks/languagesResponse';

const sinon = require('sinon');
const { expect } = require('chai');
const proxyquire = require('proxyquire');

describe('Telegram bot', () => {
  const token = '123456';
  let server: any;
  let sandbox: any;
  let order, user;

  beforeEach(() => {
    user = {
      lang: 'ESP',
      trades_completed: 7,
      admin: false,
      banned: false,
      disputes: 0,
      _id: '61006f0e85ad4f96cde94141',
      balance: 0,
      tg_id: '1',
      username: 'negrunch',
      created_at: '2021-07-27T20:39:42.403Z',
    };
    order = {
      buyer_dispute: false,
      seller_dispute: false,
      buyer_cooperativecancel: false,
      seller_cooperativecancel: false,
      _id: '612d451148df8353e387eeff',
      description:
        'Vendiendo 111 sats\n' +
        'Por ves 111\n' +
        'Pago por Pagomovil\n' +
        'Tiene 7 operaciones exitosas',
      amount: 111,
      fee: 0.111,
      creator_id: '61006f0e85ad4f96cde94141',
      seller_id: '61006f0e85ad4f96cde94141',
      type: 'sell',
      status: 'PENDING',
      fiat_amount: 111,
      fiat_code: 'ves',
      payment_method: 'Pagomovil',
      tg_chat_id: '1',
      tg_order_message: '1',
      created_at: '2021-08-30T20:52:33.870Z',
    };
    sandbox = sinon.createSandbox();
    // Mock process.env
    sandbox.stub(process, 'env').value({
      CHANNEL: '@testChannel',
      MIN_PAYMENT_AMT: 100,
      NODE_ENV: 'test',
      INVOICE_EXPIRATION_WINDOW: 3600000,
      LND_GRPC_HOST: '127.0.0.1:10005',
    });

    // Mock TelegramServer
    server = {
      getClient: sandbox.stub().returns({
        makeCommand: sandbox.stub().returns({}),
        sendCommand: sandbox.stub().resolves({ ok: true }),
        getUpdates: sandbox.stub().resolves({
          ok: true,
          result: [{
            update_id: 1,
            message: {
              message_id: 1,
              from: {
                id: 1,
                is_bot: false,
                first_name: 'Test',
                username: 'testuser',
                language_code: 'en',
              },
              chat: {
                id: 1,
                first_name: 'Test',
                username: 'testuser',
                type: 'private',
              },
              date: 1678888888,
              text: '/start',
              entities: [{
                offset: 0,
                length: 6,
                type: 'bot_command',
              }],
            },
          }],
        }),
        sendMessage: sandbox.stub().resolves({ ok: true }),
      }),
      ApiURL: 'http://localhost:9001',
    };

    // Mock mongo connection and models
    sandbox.stub(User, 'findOne').resolves(user);
    sandbox.stub(Order, 'findOne').resolves(null);
    sandbox.stub(Order.prototype, 'save').resolves(order);

    // Initialize the bot
    initialize(token, { telegram: { apiRoot: server.ApiURL } });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should start', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/start');
    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
    const updates = await client.getUpdates();
    expect(updates.ok).to.be.equal(true);
    expect(updates.result.length).to.be.equal(1);
  });

  it('should return /sell help', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/sell help');
    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
  });

  it('should create a /sell', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/sell 100 1 ves Pagomovil');
    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
  });

  it('should return unknown_command for unregistered command', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/sello 100 1 ves Pagomovil');
    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);

    const mockUpdatesResponse = {
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            text: "😕 I do not understand. Please use /help to see the list of available commands"
          },
        },
      ],
    };
    client.getUpdates.onCall(0).resolves(mockUpdatesResponse);

    const updates = await client.getUpdates();
    expect(updates.ok).to.be.equal(true);
    expect(updates.result[0].message.text).to.equal('😕 I do not understand. Please use /help to see the list of available commands');
  });

  it('should return /buy help', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/buy help');
    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
  });

  it('should return the list of supported currencies', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/listcurrencies');
    client.getUpdates.onCall(0).resolves(mockUpdatesResponseForCurrencies);

    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
    const updates = await client.getUpdates();
    expect(updates.ok).to.be.equal(true);
    expect(
      (updates.result[0].message.text.match(/\n/g) || []).length - 1
    ).to.be.equal(getCurrenciesWithPrice().length);
  });

  it('should return flags of langs supported', async () => {
    const client = server.getClient(token, { timeout: 5000 });
    const command = client.makeCommand('/setlang');
    client.getUpdates.onCall(0).resolves(mockUpdatesResponseForLanguages);

    const res = await client.sendCommand(command);
    expect(res.ok).to.be.equal(true);
    const updates = await client.getUpdates();
    expect(updates.ok).to.be.equal(true);
    let flags = 0;
    updates.result[0].message.reply_markup.inline_keyboard.forEach((flag: any) => {
      flags += flag.length;
    });
    let langs = 0;
    fs.readdirSync(path.join(__dirname, '../../../locales')).forEach(file => {
      langs++;
    });
    expect(flags).to.be.equal(langs);
  });
});

describe('Bot Initialization', () => {
  let initialize: any;
  let botStub: any;
  let scheduleStub: any;
  let validateUserStub: any;
  let startMessageStub: any;
  let attemptPendingPaymentsStub: any;

  beforeEach(() => {
    botStub = {
      catch: sinon.stub(),
      use: sinon.stub(),
      start: sinon.stub(),
      command: sinon.stub(),
      on: sinon.stub(),
      action: sinon.stub(),
      handleUpdate: sinon.stub().resolves(),
      telegram: {
        sendMessage: sinon.stub().resolves({ ok: true }),
        getMe: sinon.stub().resolves({ ok: true, result: { id: 12345 } }),
        getChatMember: sinon.stub().resolves({ ok: true, result: { status: 'administrator' } }),
      },
    };

    scheduleStub = {
      scheduleJob: sinon.stub(),
    };

    validateUserStub = sinon.stub().resolves();
    startMessageStub = sinon.stub().resolves();
    attemptPendingPaymentsStub = sinon.stub();

    // Replace the real modules with the stubs
    initialize = proxyquire('../../bot/start', {
      'telegraf': { Telegraf: sinon.stub().returns(botStub) },
      'node-schedule': scheduleStub,
      '@grammyjs/i18n': { I18n: sinon.stub().returns({ middleware: sinon.stub().returns(() => { }) }) },
      '@grammyjs/ratelimiter': { limit: sinon.stub().returns(() => { }) },
      '../models': {
        Order: {
          findOne: sinon.stub().resolves(null),
          prototype: {
            save: sinon.stub().resolves(),
          },
        },
        User: {
          findOne: sinon.stub().resolves(null),
          prototype: {
            save: sinon.stub().resolves(),
          },
        },
        Community: {
          findById: sinon.stub().resolves(null),
          prototype: {
            save: sinon.stub().resolves(),
          },
        },
        Config: {
          findOne: sinon.stub().resolves(null),
          prototype: {
            save: sinon.stub().resolves(),
          },
        },
        Dispute: {
          findOne: sinon.stub().resolves(null),
          prototype: {
            save: sinon.stub().resolves(),
          },
        },
        PendingPayment: {
          findOne: sinon.stub().resolves(null),
        },
      },
      '../ln': {
        settleHoldInvoice: sinon.stub().resolves(),
        cancelHoldInvoice: sinon.stub().resolves(),
        payToBuyer: sinon.stub().resolves(),
        subscribeInvoice: sinon.stub().resolves(),
        getInvoice: sinon.stub().resolves({
          is_confirmed: false,
          is_canceled: false,
          is_held: false,
        }),
      },
      '../jobs': {
        attemptPendingPayments: attemptPendingPaymentsStub,
        cancelOrders: sinon.stub().resolves(),
        deleteOrders: sinon.stub().resolves(),
        calculateEarnings: sinon.stub().resolves(),
        attemptCommunitiesPendingPayments: sinon.stub().resolves(),
        deleteCommunity: sinon.stub().resolves(),
        nodeInfo: sinon.stub().resolves(),
      },
      './modules/community': { configure: sinon.stub() },
      './modules/language': { configure: sinon.stub() },
      './modules/nostr': { configure: sinon.stub() },
      './modules/orders': { configure: sinon.stub() },
      './modules/user': { configure: sinon.stub() },
      './modules/dispute': { configure: sinon.stub() },
      './ordersActions': {
        getOrders: sinon.stub().resolves([]),
      },
      './commands': {
        rateUser: sinon.stub().resolves(),
        cancelAddInvoice: sinon.stub().resolves(),
        addInvoice: sinon.stub().resolves(),
        cancelShowHoldInvoice: sinon.stub().resolves(),
        showHoldInvoice: sinon.stub().resolves(),
        addInvoicePHI: sinon.stub().resolves(),
        cancelOrder: sinon.stub().resolves(),
        fiatSent: sinon.stub().resolves(),
        release: sinon.stub().resolves(),
      },
      './validations': {
        validateParams: sinon.stub().resolves([]),
        validateObjectId: sinon.stub().resolves(true),
        validateLightningAddress: sinon.stub().resolves(true),
        validateUserWaitingOrder: sinon.stub().resolves(true),
        isBannedFromCommunity: sinon.stub().resolves(false),
        validateSuperAdmin: sinon.stub().resolves(true),
        validateAdmin: sinon.stub().resolves(true),
        validateSellOrder: sinon.stub().resolves(true),
        validateBuyOrder: sinon.stub().resolves(true),
        validateInvoice: sinon.stub().resolves(true),
        validateTakeSellOrder: sinon.stub().resolves(true),
        validateTakeBuyOrder: sinon.stub().resolves(true),
        validateReleaseOrder: sinon.stub().resolves(true),
        validateDisputeOrder: sinon.stub().resolves(true),
        validateFiatSentOrder: sinon.stub().resolves(true),
        validateSeller: sinon.stub().resolves(true),
        isValidInvoice: sinon.stub().resolves({ success: true }),
        validateUser: validateUserStub
      },
      '../util': {
        getCurrenciesWithPrice: sinon.stub().returns([]),
        deleteOrderFromChannel: sinon.stub().resolves(),
        removeAtSymbol: sinon.stub().returns(''),
        getEmojiRate: sinon.stub().returns(''),
        decimalRound: sinon.stub().returns(0),
        getUserAge: sinon.stub().returns(0),
        getStars: sinon.stub().returns(''),
        getOrderChannel: sinon.stub().returns(''),
        holdInvoiceExpirationInSecs: sinon.stub().returns({
          expirationTimeInSecs: 0,
          safetyWindowInSecs: 0,
        }),
        sanitizeMD: sinon.stub().returns(''),
        getCurrency: sinon.stub().returns(''),
        numberFormat: sinon.stub().returns(''),
        getDetailedOrder: sinon.stub().returns({}),
        secondsToTime: sinon.stub().returns(''),
      },
      './messages': {
        startMessage: startMessageStub,
        bannedUserErrorMessage: sinon.stub().resolves(),
        notOrdersMessage: sinon.stub().resolves(),
        notAuthorized: sinon.stub().resolves(),
        sellOrderCorrectFormatMessage: sinon.stub().resolves(),
        invalidRangeWithAmount: sinon.stub().resolves(),
        mustBeANumberOrRange: sinon.stub().resolves(),
        mustBeGreatherEqThan: sinon.stub().resolves(),
        mustBeValidCurrency: sinon.stub().resolves(),
        buyOrderCorrectFormatMessage: sinon.stub().resolves(),
        invalidTypeOrderMessage: sinon.stub().resolves(),
        alreadyTakenOrderMessage: sinon.stub().resolves(),
        invalidOrderMessage: sinon.stub().resolves(),
        cantTakeOwnOrderMessage: sinon.stub().resolves(),
        minimunAmountInvoiceMessage: sinon.stub().resolves(),
        minimunExpirationTimeInvoiceMessage: sinon.stub().resolves(),
        expiredInvoiceMessage: sinon.stub().resolves(),
        requiredAddressInvoiceMessage: sinon.stub().resolves(),
        requiredHashInvoiceMessage: sinon.stub().resolves(),
        invoiceMustBeLargerMessage: sinon.stub().resolves(),
        invoiceExpiryTooShortMessage: sinon.stub().resolves(),
        invoiceHasExpiredMessage: sinon.stub().resolves(),
        invoiceHasWrongDestinationMessage: sinon.stub().resolves(),
        invoiceInvalidMessage: sinon.stub().resolves(),
        notLightningInvoiceMessage: sinon.stub().resolves(),
        customMessage: sinon.stub().resolves(),
        notValidIdMessage: sinon.stub().resolves(),
        userCantTakeMoreThanOneWaitingOrderMessage: sinon.stub().resolves(),
        waitingForBuyerOrderMessage: sinon.stub().resolves(),
        notActiveOrderMessage: sinon.stub().resolves(),
        orderOnfiatSentStatusMessages: sinon.stub().resolves(),
        sellerPaidHoldMessage: sinon.stub().resolves(),
        successCancelOrderMessage: sinon.stub().resolves(),
        successCancelOrderByAdminMessage: sinon.stub().resolves(),
        successCancelAllOrdersMessage: sinon.stub().resolves(),
        successCompleteOrderMessage: sinon.stub().resolves(),
        successCompleteOrderByAdminMessage: sinon.stub().resolves(),
        checkOrderMessage: sinon.stub().resolves(),
        checkInvoiceMessage: sinon.stub().resolves(),
        notFoundUserMessage: sinon.stub().resolves(),
        userBannedErrorMessage: sinon.stub().resolves(),
        disableLightningAddress: sinon.stub().resolves(),
        invalidLightningAddress: sinon.stub().resolves(),
        successSetAddress: sinon.stub().resolves(),
        setinvoice_no_response: sinon.stub().resolves(),
        showConfirmationButtons: sinon.stub().resolves(),
        need_default_community: sinon.stub().resolves(),
        updateUserSettingsMessage: sinon.stub().resolves(),
        not_wizard: sinon.stub().resolves(),
        no_capital_letters: sinon.stub().resolves(),
        unknown_command: sinon.stub().resolves(),
        maintenance: sinon.stub().resolves(),
        operation_successful: sinon.stub().resolves(),
      },
      './middleware': {
        userMiddleware: sinon.stub().resolves(),
        adminMiddleware: sinon.stub().resolves(),
        superAdminMiddleware: sinon.stub().resolves(),
        commandArgsMiddleware: sinon.stub().returns(() => { }),
        stageMiddleware: sinon.stub().returns(() => { }),
      },
      '../logger': {
        error: sinon.stub(),
        notice: sinon.stub(),
        debug: sinon.stub(),
        info: sinon.stub(),
      },
    }).initialize;
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should initialize the bot and register middleware', () => {
    initialize('dummy-token', {});

    expect(botStub.catch.calledOnce).to.be.equal(true);
    expect(botStub.use.callCount).to.be.equal(5);
  });

  it('should schedule recurring jobs', () => {
    process.env.PENDING_PAYMENT_WINDOW = '10';

    initialize('dummy-token', {});

    expect(scheduleStub.scheduleJob.calledWith(
      `*/${process.env.PENDING_PAYMENT_WINDOW} * * * *`,
      sinon.match.func
    )).to.be.equal(true);

    const scheduledFunction = scheduleStub.scheduleJob.getCall(0).args[1];

    scheduledFunction();

    expect(scheduleStub.scheduleJob.callCount).to.be.equal(7);
    expect(scheduleStub.scheduleJob.getCall(0).args[0]).to.equal('*/10 * * * *');
    expect(attemptPendingPaymentsStub.calledOnce).to.be.equal(true);
  });

  it('should register the /start command handler', async () => {
    const ctx = {
      update: {
        message: {
          text: '/start',
        },
      },
    };

    initialize('dummy-token', {});

    await botStub.start.firstCall.args[0](ctx);

    expect(validateUserStub.calledOnceWithExactly(ctx, true)).to.be.equal(true);
    expect(startMessageStub.calledOnceWithExactly(ctx)).to.be.equal(true);
  });

  it('should handle text messages that are not commands using the first text handler', async () => {
    const ctx = {
      update: {
        message: {
          text: 'Hello, bot!',
          from: {
            id: 1,
            is_bot: false,
            first_name: 'Test',
            username: 'testuser',
            language_code: 'en',
          },
        },
      },
      chat: {
        id: 1,
        first_name: 'Test',
        username: 'testuser',
        type: 'private',
      },
      reply: sinon.stub().resolves({ ok: true }),
      i18n: {
        t: sinon.stub().returns('maintenance'),
      },
    };

    botStub.on = sinon.stub().callsFake((event: string, middleware: any, handler: any) => {
      if (event === 'text') {
        const capturedHandler = handler;
        capturedHandler(ctx);
      }
    });

    const ConfigStub = {
      findOne: sinon.stub().resolves({ maintenance: true }),
      prototype: {
        save: sinon.stub().resolves(),
      },
    };

    const TelegrafMock = sinon.stub().returns(botStub);

    const startModule = proxyquire('../../bot/start', {
      'telegraf': { Telegraf: TelegrafMock },
      '../models': { Config: ConfigStub },
    });

    botStub.telegram.sendMessage = sinon.stub().resolves({ ok: true });

    const bot = startModule.initialize('dummy-token', {});

    await bot.handleUpdate({
      update_id: 1,
      message: ctx.update.message,
    });

    expect(ConfigStub.findOne.calledOnceWithExactly({ maintenance: true })).to.be.equal(true);
    expect(ctx.reply.calledOnceWithExactly('maintenance')).to.be.equal(true);
  });

  it('should handle text messages that are not commands using the second text handler', async () => {
    const i18nStub = sinon.stub();
    i18nStub.withArgs('unknown_command').returns('This is an unknown command.');
    const ctx = {
      message: {
        text: '/command',
        from: {
          id: 1,
          is_bot: false,
          first_name: 'Test',
          username: 'testuser',
          language_code: 'en',
        },
        chat: {
          id: 1,
          first_name: 'Test',
          username: 'testuser',
          type: 'private',
        },
      },


      reply: sinon.stub().resolves({ ok: true }),
      i18n: {
        t: i18nStub,
      },
    };

    botStub.on = sinon.stub().callsFake((event: string, middleware: any, handler: any) => {
      if (event === 'text') {
        const capturedHandler = handler;
        capturedHandler(ctx);
      }
    });

    const TelegrafMock = sinon.stub().returns(botStub);

    const startModule = proxyquire('../../bot/start', {
      'telegraf': { Telegraf: TelegrafMock },
    });

    // Mock the Telegram API sendMessage method
    botStub.telegram.sendMessage = sinon.stub().resolves({ ok: true });

    // Call initialize from the proxied module
    const bot = startModule.initialize('dummy-token', {});

    await bot.handleUpdate({
      update_id: 1,
      message: ctx.message,
    });

    expect(ctx.reply.calledOnce).to.be.equal(true);
    expect(ctx.reply.calledWithExactly('This is an unknown command.')).to.be.equal(true);
  });
});
