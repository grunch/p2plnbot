import {
  validateSellOrder,
  validateBuyOrder,
  validateInvoice,
  isValidInvoice,
  validateUser,
  validateParams,
  validateObjectId,
  validateSuperAdmin,
  validateAdmin,
  validateTakeSellOrder,
  validateUserWaitingOrder,
  isBannedFromCommunity,
} from '../../bot/validations';
import * as messages from '../../bot/messages';
import { Order, User, Community } from '../../models';
import { IOrder } from '../../models/order';

const { expect } = require('chai');
const sinon = require('sinon');
const { ObjectId } = require('mongoose').Types;
const proxyquire = require('proxyquire');

describe('Validations', () => {
  let ctx: any;
  let replyStub: any;
  let sandbox: any;
  let validations: any;
  let existLightningAddressStub: any;
  let isDisputeSolverStub: any;
  let isOrderCreatorStub;
  let bot: any, user: any, community: any;

  beforeEach(() => {
    ctx = {
      i18n: {
        t: (key: any) => key,
        locale: () => 'en',
      },
      state: {
        command: {
          args: [],
        },
      },
      update: {
        callback_query: {
          from: {
            id: 1,
          },
        },
        message: {
          text: '',
          from: {
            id: 1,
          },
        },
      },
      telegram: {
        sendMessage: sinon.stub(),
      },
      reply: () => {},
      botInfo: {
        username: 'testbot',
      },
    };

    sandbox = sinon.createSandbox();
    // Mock process.env within the sandbox
    sandbox.stub(process, 'env').value({
      MIN_PAYMENT_AMT: 100,
      NODE_ENV: 'production',
      INVOICE_EXPIRATION_WINDOW: 3600000,
    });

    replyStub = sinon.stub(ctx, 'reply');
    existLightningAddressStub = sinon.stub();
    isDisputeSolverStub = sinon.stub();
    isOrderCreatorStub = sinon.stub();
    validations = proxyquire('../../bot/validations', {
      '../lnurl/lnurl-pay': {
        existLightningAddress: existLightningAddressStub,
      },
      '../util': {
        isDisputeSolver: isDisputeSolverStub,
        isOrderCreator: isOrderCreatorStub,
      },
    });
    bot = {
      telegram: {
        sendMessage: sinon.stub(),
      },
    };
    user = {
      _id: new ObjectId(),
      tg_id: 12345,
    };
  });

  afterEach(() => {
    sinon.restore();
    sandbox.restore();
  });

  describe('validateSellOrder', () => {
    it('should return false if args length is less than 4', async () => {
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return false if amount is not a number', async () => {
      ctx.state.command.args = ['test', '100', 'USD', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return false if fiat amount is not a number', async () => {
      ctx.state.command.args = ['10000', 'test', 'USD', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return false if fiat code is not valid, fiat code less than 3 characters', async () => {
      ctx.state.command.args = ['10000', '100', 'US', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return false if fiat code is not valid, fiat code more than 5 characters', async () => {
      ctx.state.command.args = ['10000', '100', 'USSDDD', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return false if amount is less than minimum', async () => {
      ctx.state.command.args = ['1', '100', 'USD', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.equal(true);
    });

    it('should return object if validation success', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle'];
      const result = await validateSellOrder(ctx);
      expect(result).to.be.an('object');
    });

    it('should return object if validation success with price margin', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle', '5'];
      const result = await validateSellOrder(ctx);
      if(result === false) throw new Error("object expected");
      expect(result.priceMargin).to.equal('5');
    });

    it('should return false if price margin is not a number', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle', 'test'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should work with ranges', async () => {
      ctx.state.command.args = ['0', '100-200', 'USD', 'zelle', '5'];
      const result = await validateSellOrder(ctx);
      if(result === false) throw new Error("object expected");
      expect(result.fiatAmount).to.deep.equal([100, 200]);
    });

    it('should fail with ranges with double dash', async () => {
      ctx.state.command.args = ['0', '100--200', 'USD', 'zelle', '5'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
    });

    it('should fail with invalid ranges', async () => {
      ctx.state.command.args = ['0', '200-100', 'USD', 'zelle', '5'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
    });

    it('should fail with ranges and amount', async () => {
      ctx.state.command.args = ['1000', '100-200', 'USD', 'zelle', '5'];
      const result = await validateSellOrder(ctx);
      expect(result).to.equal(false);
    });
  });

  describe('validateBuyOrder', () => {
    it('should return false if args length is less than 4', async () => {
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should return false if amount is not a number', async () => {
      ctx.state.command.args = ['test', '100', 'USD', 'zelle'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should return false if fiat amount is not a number', async () => {
      ctx.state.command.args = ['10000', 'test', 'USD', 'zelle'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should return false if amount is less than minimum', async () => {
      ctx.state.command.args = ['1', '100', 'USD', 'zelle'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should return object if validation success', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.be.an('object');
    });

    it('should return object if validation success with price margin', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle', '5'];
      const result = await validateBuyOrder(ctx);
      if(result === false) throw new Error("object expected");
      expect(result.priceMargin).to.equal('5');
    });

    it('should return false if price margin is not a number', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle', 'test'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
      expect(replyStub.calledOnce).to.be.equal(true);
    });

    it('should work with ranges', async () => {
      ctx.state.command.args = ['0', '100-200', 'USD', 'zelle', '5'];
      const result = await validateBuyOrder(ctx);
      if(result === false) throw new Error("object expected");
      expect(result.fiatAmount).to.deep.equal([100, 200]);
    });

    it('should fail with ranges with double dash', async () => {
      ctx.state.command.args = ['0', '100--200', 'USD', 'zelle', '5'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
    });

    it('should fail with invalid ranges', async () => {
      ctx.state.command.args = ['0', '200-100', 'USD', 'zelle', '5'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
    });

    it('should fail with ranges and amount', async () => {
      ctx.state.command.args = ['1000', '100-200', 'USD', 'zelle', '5'];
      const result = await validateBuyOrder(ctx);
      expect(result).to.equal(false);
    });
  });

  describe('validateLightningAddress', () => {
    it('should return true for a valid lightning address', async () => {
      existLightningAddressStub.withArgs('test@ln.com').returns(true);
      const result = await validations.validateLightningAddress('test@ln.com');
      expect(result).to.equal(true);
    });

    it('should return false for an invalid lightning address (existence)', async () => {
      existLightningAddressStub.withArgs('test@invalid.com').returns(false);
      const result = await validations.validateLightningAddress(
        'test@invalid.com'
      );
      expect(result).to.equal(false);
    });
  });

  describe('validateUser', () => {
    it('should create a new user if it does not exist', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser',
        id: '1',
      };

      sinon.stub(User, 'findOne').resolves(null);
      sinon.stub(User.prototype, 'save').resolves();
      const user = await validateUser(ctx, true);
      if(user === false) throw new Error("object expected");
      expect((user.save as any).calledOnce).to.equal(true);
      expect(user).to.be.an('object');
      expect(user.tg_id).to.be.equal(ctx.update.callback_query.from.id);
      expect(user.username).to.be.equal(
        ctx.update.callback_query.from.username
      );
    });

    it('should return false if user does not exist and start is false', async () => {
      const user = await validateUser(ctx, false);
      expect(user).to.equal(false);
    });

    it('should return the user if it exists', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser',
        id: '1',
      };
      const newUser = new User({
        tg_id: ctx.update.callback_query.from.id,
        username: ctx.update.callback_query.from.username,
      });

      sinon.stub(User, 'findOne').resolves(newUser);

      const user = await validateUser(ctx, false);
      if(user === false) throw new Error("object expected");
      expect(user.tg_id).to.be.equal(newUser.tg_id);
      expect(user.username).to.be.equal(newUser.username);
    });

    it('should update the username if it has changed', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser-updated',
        id: '1',
      };
      const newUser = new User({
        tg_id: ctx.update.callback_query.from.id,
        username: ctx.update.callback_query.from.username,
      });

      sinon.stub(User, 'findOne').resolves(newUser);

      const user = await validateUser(ctx, false);
      if(user === false) throw new Error("object expected");
      expect(user.tg_id).to.be.equal(newUser.tg_id);
      expect(user.username).to.be.equal('testuser-updated');
    });

    it('should return false if the user is banned', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser',
        id: '1',
      };
      const newUser = new User({
        tg_id: ctx.update.callback_query.from.id,
        username: ctx.update.callback_query.from.username,
        banned: true,
      });

      sinon.stub(User, 'findOne').resolves(newUser);

      const user = await validateUser(ctx, false);
      expect(user).to.equal(false);
    });
  });

  describe('validateSuperAdmin', () => {
    it('should return the user if it is a superadmin', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser',
        id: '1',
      };
      const newUser = new User({
        tg_id: ctx.update.callback_query.from.id,
        username: ctx.update.callback_query.from.username,
        admin: true,
      });

      sinon.stub(User, 'findOne').resolves(newUser);

      const user = await validateSuperAdmin(ctx);
      if(user === false || user === undefined) throw new Error("object expected");
      expect(user.tg_id).to.be.equal(newUser.tg_id);
      expect(user.admin).to.equal(true);
    });

    it('should return false if the user is not a superadmin', async () => {
      ctx.update.callback_query.from = {
        username: 'testuser',
        id: '1',
      };
      const newUser = new User({
        tg_id: ctx.update.callback_query.from.id,
        username: ctx.update.callback_query.from.username,
        admin: false,
      });

      sinon.stub(User, 'findOne').resolves(newUser);

      const user = await validateSuperAdmin(ctx);
      expect(user).to.equal(undefined);
    });
  });

  describe('validateAdmin', () => {
    it('should return the user if it is an admin', async () => {
      const newCommunity = new Community({
        name: 'testcommunity',
      });
      const newUser = new User({
        tg_id: ctx.update.message.from.id,
        username: ctx.update.message.from.username,
        admin: true,
        default_community_id: new ObjectId(newCommunity._id),
      });

      sinon.stub(User, 'findOne').resolves(newUser);
      sinon.stub(Community, 'findOne').resolves(newCommunity);
      isDisputeSolverStub.withArgs(newCommunity, newUser).returns(true);
      const user = await validateAdmin(ctx);
      if(user === false || user === undefined) throw new Error("object expected");
      expect(user.tg_id).to.be.equal(newUser.tg_id);
      expect(user.admin).to.equal(true);
    });

    it('should return undefined if the user is not exist', async () => {
      sinon.stub(User, 'findOne').resolves(null);

      const user = await validateAdmin(ctx);
      expect(user).to.equal(undefined);
    });

    it('should return undefined if the user is not dispute solver and it is not an admin', async () => {
      const newCommunity = new Community({
        name: 'testcommunity',
      });
      const newUser = new User({
        tg_id: ctx.update.message.from.id,
        username: ctx.update.message.from.username,
        admin: false,
        default_community_id: new ObjectId(newCommunity._id),
      });

      sinon.stub(User, 'findOne').resolves(newUser);
      sinon.stub(Community, 'findOne').resolves(newCommunity);
      isDisputeSolverStub.withArgs(newCommunity, newUser).returns(false);

      const user = await validateAdmin(ctx);
      expect(user).to.equal(undefined);
    });
  });

  describe('validateSellOrder', () => {
    it('should return false if the amount is not a number', async () => {
      ctx.state.command.args = ['test', '100', 'USD', 'zelle'];
      const order = await validateSellOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return false if the fiat amount is not a number', async () => {
      ctx.state.command.args = ['10000', 'test', 'USD', 'zelle'];
      const order = await validateSellOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return false if the fiat code is not valid', async () => {
      ctx.state.command.args = ['10000', '100', 'invalid', 'zelle'];
      const order = await validateSellOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return the order data if the order is valid', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle'];
      const order = await validateSellOrder(ctx);
      if(order === false) throw new Error("object expected");
      expect(order.amount).to.be.equal(10000);
      expect(order.fiatAmount).to.be.an('array').to.deep.equal([100]);
      expect(order.fiatCode).to.be.equal('USD');
      expect(order.paymentMethod).to.be.equal('zelle');
    });
  });

  describe('validateBuyOrder', () => {
    it('should return false if the amount is not a number', async () => {
      ctx.state.command.args = ['test', '100', 'USD', 'zelle'];
      const order = await validateBuyOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return false if the fiat amount is not a number', async () => {
      ctx.state.command.args = ['10000', 'test', 'USD', 'zelle'];
      const order = await validateBuyOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return false if the fiat code is not valid', async () => {
      ctx.state.command.args = ['10000', '100', 'invalid', 'zelle'];
      const order = await validateBuyOrder(ctx);
      expect(order).to.equal(false);
    });

    it('should return the order data if the order is valid', async () => {
      ctx.state.command.args = ['10000', '100', 'USD', 'zelle'];
      const order = await validateBuyOrder(ctx);
      if(order === false) throw new Error("object expected");
      expect(order.amount).to.be.equal(10000);
      expect(order.fiatAmount).to.be.an('array').to.deep.equal([100]);
      expect(order.fiatCode).to.be.equal('USD');
      expect(order.paymentMethod).to.be.equal('zelle');
    });
  });

  // TODO possible duplicated of isValidInvoice
  describe('validateInvoice', () => {
    // This test goes to the catch
    it('should return false if the invoice is not valid', async () => {
      const invoice = await validateInvoice(ctx, 'invalid-invoice');
      expect(invoice).to.equal(false);
    });

    it('should return false if the invoice amount is too low', async () => {
      const minPaymentAmount = 10;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: '2023-03-15T12:14:48.000Z',
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'minimunAmountInvoiceMessage');

      const invoice = await validateInvoice(ctx, lnInvoice);

      expect((messages.minimunAmountInvoiceMessage as any).calledOnce).to.equal(true);
      expect(invoice).to.equal(false);
    });

    it('should return false if the invoice is expired with an expired date', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: '2023-09-23T11:00:00.000Z',
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'minimunExpirationTimeInvoiceMessage');

      const invoice = await validateInvoice(ctx, lnInvoice);

      expect((messages.minimunExpirationTimeInvoiceMessage as any).calledOnce).to.equal(
        true
      );
      expect(invoice).to.equal(false);
    });

    it('should return false if the invoice is expired with is_expired true', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: true,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'expiredInvoiceMessage');

      const invoice = await validateInvoice(ctx, lnInvoice);

      expect((messages.expiredInvoiceMessage as any).calledOnce).to.equal(true);
      expect(invoice).to.equal(false);
    });
    it('should return false if the invoice does not have a destination address', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        // destination: '03...', Missed destination address
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'requiredAddressInvoiceMessage');

      const invoice = await validateInvoice(ctx, lnInvoice);

      expect((messages.requiredAddressInvoiceMessage as any).calledOnce).to.equal(true);
      expect(invoice).to.equal(false);
    });
    it('should return false if the invoice does not have an id', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        // id: '123', Missed Id
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'requiredHashInvoiceMessage');

      const invoice = await validateInvoice(ctx, lnInvoice);

      expect((messages.requiredHashInvoiceMessage as any).calledOnce).to.equal(true);
      expect(invoice).to.equal(false);
    });
    it('should return the invoice if it is valid', async () => {
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: 20000,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { validateInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lnbc20m1p0t9k3gpp5kqum3c9qsp58yj2cp8gp5c9yqcnzen9s08jx2p4d7r97777g4qsq9qy9qsqgqqqqqqgqqqqqqgqjqdhnx9';

      const invoice = await validateInvoice(ctx, lnInvoice);
      expect(invoice).to.be.an('object');
      expect(invoice.network).to.be.equal('bc');
      expect(invoice.tokens).to.be.equal(20000);
    });
  });

  describe('isValidInvoice', () => {
    // This goes to the catch
    it('should return false if the invoice is not valid', async () => {
      sinon.stub(messages, 'invoiceInvalidMessage');

      const { success } = await isValidInvoice(ctx, 'invalid-invoice');
      expect(success).to.equal(false);
      expect((messages.invoiceInvalidMessage as any).calledOnce).to.equal(true);
    });

    it('should return false if the invoice amount is too low', async () => {
      const minPaymentAmount = 10;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: '2023-03-15T12:14:48.000Z',
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'invoiceMustBeLargerMessage');

      const { success } = await isValidInvoice(ctx, lnInvoice);

      expect((messages.invoiceMustBeLargerMessage as any).calledOnce).to.equal(true);
      expect(success).to.equal(false);
    });

    it('should return false if the invoice is expired with an expired date', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: '2023-09-23T11:00:00.000Z',
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'invoiceExpiryTooShortMessage');

      const { success } = await isValidInvoice(ctx, lnInvoice);

      expect((messages.invoiceExpiryTooShortMessage as any).calledOnce).to.equal(true);
      expect(success).to.equal(false);
    });

    it('should return false if the invoice is expired with is_expired true', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: true,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'invoiceHasExpiredMessage');

      const { success } = await isValidInvoice(ctx, lnInvoice);

      expect((messages.invoiceHasExpiredMessage as any).calledOnce).to.equal(true);
      expect(success).to.equal(false);
    });
    it('should return false if the invoice does not have a destination address', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        // destination: '03...', Missed destination address
        id: '123',
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'invoiceHasWrongDestinationMessage');

      const { success } = await isValidInvoice(ctx, lnInvoice);

      expect((messages.invoiceHasWrongDestinationMessage as any).calledOnce).to.equal(
        true
      );
      expect(success).to.equal(false);
    });
    it('should return false if the invoice does not have an id', async () => {
      const minPaymentAmount = 2000;
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        // id: '123', Missed Id
        tokens: minPaymentAmount,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lntb1u1p0g9j8ypqsp5xwyewd3a2v9hk6cakck29p29dj79wsdq6sty85c3qtgzq0w9qmmvpjlncqp58yj98ygg77skup0l293p7memz0hxq698j2zcqzpgxqyz5vqsp5uscy8wn5z9cqlcw78pd6skddj3sr8gzk9c9jxqyjw5d9q8wkdgg7z0xpvyjry9a9q6d8h829vdje7r29s5pjq7939v9kck2gsqgjg9';

      sinon.stub(messages, 'requiredHashInvoiceMessage');

      const { success } = await isValidInvoice(ctx, lnInvoice);

      expect((messages.requiredHashInvoiceMessage as any).calledOnce).to.equal(true);
      expect(success).to.equal(false);
    });
    it('should return the invoice if it is valid', async () => {
      const resInvoice = {
        network: 'bc',
        destination: '03...',
        id: '123',
        tokens: 20000,
        description: '',
        expiry: 3600,
        timestamp: 1678888888,
        features: {},
        routes: [],
        cltv_expiry: 9,
        is_expired: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(), // One day after
      };
      const { isValidInvoice } = proxyquire('../../bot/validations', {
        invoices: {
          parsePaymentRequest: sinon.stub().returns(resInvoice),
        },
      });

      const lnInvoice =
        'lnbc20m1p0t9k3gpp5kqum3c9qsp58yj2cp8gp5c9yqcnzen9s08jx2p4d7r97777g4qsq9qy9qsqgqqqqqqgqqqqqqgqjqdhnx9';

      const { invoice } = await isValidInvoice(ctx, lnInvoice);
      expect(invoice).to.be.an('object');
      expect(invoice.network).to.be.equal('bc');
      expect(invoice.tokens).to.be.equal(20000);
    });
  });

  describe('validateTakeSellOrder', () => {
    it('should return false if the order does not exist', async () => {
      const user = { _id: '1' };
      const order = null;

      sinon.stub(messages, 'invalidOrderMessage').resolves();

      const isValid = await validateTakeSellOrder(ctx, {} as any, user as any, order);

      expect((messages.invalidOrderMessage as any).calledOnce).to.equal(true);
      expect(isValid).to.equal(false);
    });

    it('should return false if the user is the order creator', async () => {
      const user = { _id: '1' };
      const order = {
        creator_id: '1',
        type: 'sell',
        status: 'PENDING',
      } as IOrder;

      sinon.stub(messages, 'cantTakeOwnOrderMessage').resolves();

      const isValid = await validateTakeSellOrder(ctx, {} as any, user as any, order);

      expect((messages.cantTakeOwnOrderMessage as any).calledOnce).to.equal(true);
      expect(isValid).to.equal(false);
    });

    it('should return false if the order type is not sell', async () => {
      const user = { _id: '2' };
      const order = {
        creator_id: '1',
        type: 'buy',
        status: 'PENDING',
      } as IOrder;

      sinon.stub(messages, 'invalidTypeOrderMessage').resolves();

      const isValid = await validateTakeSellOrder(ctx, {} as any, user as any, order);

      expect((messages.invalidTypeOrderMessage as any).calledOnce).to.equal(true);
      expect(isValid).to.equal(false);
    });

    it('should return false if the order status is not PENDING', async () => {
      const user = { _id: '2' };
      const order = {
        creator_id: '1',
        type: 'sell',
        status: 'ACTIVE',
      } as IOrder;

      sinon.stub(messages, 'alreadyTakenOrderMessage').resolves();

      const isValid = await validateTakeSellOrder(ctx, {} as any, user as any, order);

      expect((messages.alreadyTakenOrderMessage as any).calledOnce).to.equal(true);
      expect(isValid).to.equal(false);
    });
  });

  describe('validateParams', () => {
    it('should return empty array if params length is not equal to paramNumber', async () => {
      ctx.update.message.text = '/command param1 param2 param3';

      sinon.stub(messages, 'customMessage').resolves();

      const result = await validateParams(ctx, 3, 'errOutputString');
      expect(result).to.be.an('array').to.have.lengthOf(0);
      expect((messages.customMessage as any).calledOnce).to.equal(true);
    });

    it('should return sliced array if params length is equal to paramNumber', async () => {
      ctx.update.message.text = '/command param1 param2';
      const result = await validateParams(ctx, 3, 'errOutputString');
      expect(result).to.deep.equal(['param1', 'param2']);
      expect(ctx.reply.notCalled).to.equal(true);
    });
  });

  describe('validateObjectId', () => {
    it('should return true if id is valid', async () => {
      const validId = new ObjectId();
      const result = await validateObjectId(ctx, validId.toString());
      expect(result).to.equal(true);
      expect(ctx.reply.notCalled).to.equal(true);
    });

    it('should return false if id is invalid', async () => {
      const invalidId = 'invalidId';
      const result = await validateObjectId(ctx, invalidId);
      expect(result).to.equal(false);
      expect(ctx.reply.calledOnce).to.equal(true);
    });
  });

  describe('validateUserWaitingOrder', () => {
    beforeEach(() => {
      sinon.stub(Order, 'find');
    });

    afterEach(() => {
      (Order.find as any).restore();
    });

    it('should return true if user has no waiting orders', async () => {
      (Order.find as any).returns([]);
      const result = await validateUserWaitingOrder(ctx, bot, user);
      expect(result).to.equal(true);
    });

    it('should return false and send message if user has a waiting sell order', async () => {
      const order = {
        _id: new ObjectId(),
        seller_id: user._id,
        status: 'WAITING_PAYMENT',
      };
      (Order.find as any).onCall(0).returns([order]);
      (Order.find as any).onCall(1).returns([]);
      sinon
        .stub(messages, 'userCantTakeMoreThanOneWaitingOrderMessage')
        .resolves();
      const result = await validateUserWaitingOrder(ctx, bot, user);
      expect(result).to.equal(false);
      expect(
        (messages.userCantTakeMoreThanOneWaitingOrderMessage as any).calledOnce
      ).to.equal(true);
    });

    it('should return false and send message if user has a waiting buy order', async () => {
      const order = {
        _id: new ObjectId(),
        buyer_id: user._id,
        status: 'WAITING_BUYER_INVOICE',
      };
      (Order.find as any).onCall(0).returns([]);
      (Order.find as any).onCall(1).returns([order]);
      sinon
        .stub(messages, 'userCantTakeMoreThanOneWaitingOrderMessage')
        .resolves();
      const result = await validateUserWaitingOrder(ctx, bot, user);
      expect(result).to.equal(false);
      expect(
        (messages.userCantTakeMoreThanOneWaitingOrderMessage as any).calledOnce
      ).to.equal(true);
    });
  });

  describe('isBannedFromCommunity', () => {
    beforeEach(() => {
      community = {
        _id: new ObjectId(),
        banned_users: [],
      };
      sinon.stub(Community, 'findOne');
    });

    afterEach(() => {
      (Community.findOne as any).restore();
    });

    it('should return false if communityId is null', async () => {
      const result = await isBannedFromCommunity(user, null as any);
      expect(result).to.equal(false);
    });

    it('should return false if community is not found', async () => {
      (Community.findOne as any).returns(null);
      const result = await isBannedFromCommunity(user, community._id);
      expect(result).to.equal(false);
    });

    it('should return false if user is not banned', async () => {
      (Community.findOne as any).returns(community);
      const result = await isBannedFromCommunity(user, community._id);
      expect(result).to.equal(false);
    });

    it('should return true if user is banned', async () => {
      const user = { _id: 'userId' };
      const communityId = 'communityId';
      community.banned_users = [{ id: 'userId', username: 'username' }];

      (Community.findOne as any).returns(community);

      const result = await isBannedFromCommunity(user as any, communityId);
      expect(result).to.equal(true);
    });
  });
});
