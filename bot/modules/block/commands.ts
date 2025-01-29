import { CustomContext } from './customContext';

const { User, Block, Order } = require('../../../models');
const messages = require('./messages');
const globalMessages = require('../../messages');

const block = async (ctx: CustomContext, username: string): Promise<void> => {
  const userToBlock = await User.findOne({ username });
  const user = ctx.user;

  if (!userToBlock) {
    await globalMessages.notFoundUserMessage(ctx);
    return;
  }

  const areExistingOrders = await Order.exists({
    $or: [
      { seller_id: user.id, buyer_id: userToBlock.id },
      { seller_id: userToBlock.id, buyer_id: user.id },
    ],
    status: {
      $nin: [
        'PENDING',
        'CLOSED',
        'CANCELED_BY_ADMIN',
        'EXPIRED',
        'COMPLETED_BY_ADMIN',
      ],
    },
  });

  if (areExistingOrders) {
    await messages.ordersInProcess(ctx);
    return;
  }

  const isAlreadyBlocked = await Block.exists({
    blocker_tg_id: user.tg_id,
    blocked_tg_id: userToBlock.tg_id,
  });
  if (isAlreadyBlocked) {
    await messages.userAlreadyBlocked(ctx);
    return;
  }

  const block = new Block({
    blocker_tg_id: user.tg_id,
    blocked_tg_id: userToBlock.tg_id,
  });
  await block.save();
  await messages.userBlocked(ctx);
};

const unblock = async (ctx: CustomContext, username: string): Promise<void> => {
  const userToUnblock = await User.findOne({ username });
  const user = ctx.user;

  const result = await Block.deleteOne({
    blocker_tg_id: user.tg_id,
    blocked_tg_id: userToUnblock.tg_id,
  });

  if (result.deletedCount === 1) {
    await messages.userUnblocked(ctx);
  } else {
    await globalMessages.notFoundUserMessage(ctx);
  }
};

const blocklist = async (ctx: CustomContext): Promise<void> => {
  const blocks = await Block.find({ blocker_tg_id: ctx.user.tg_id });
  const tgIdBlocks = blocks.map(blocked => blocked.blocked_tg_id);

  if (!tgIdBlocks.length) {
    await messages.blocklistEmptyMessage(ctx);
    return;
  }

  const usersBlocked = await User.find({ tg_id: { $in: tgIdBlocks } });
  await messages.blocklistMessage(ctx, usersBlocked);
};

module.exports = { block, unblock, blocklist };
