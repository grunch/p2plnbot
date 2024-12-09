import { User, Order, Dispute } from '../../../models';
import { MainContext } from '../../start';
import * as messages from './messages';
import { validateAdmin } from '../../validations';
import * as globalMessages from '../../messages';

export const takeDispute = async (ctx: MainContext) : Promise<void> => {
  const tgId: string = (ctx.update as any).callback_query.from.id;
  const admin = await validateAdmin(ctx, tgId);
  if (!admin) return;
  const orderId = ctx.match?.[1];
  // We check if this is a solver, the order must be from the same community
  const order = await Order.findOne({ _id: orderId });
  if(order === null)
    throw new Error("order not found");
  const dispute = await Dispute.findOne({ order_id: orderId });
  if(dispute === null)
    throw new Error("dispute not found");
  if (!admin.admin) {
    if (!order.community_id)
      return await globalMessages.notAuthorized(ctx, tgId);

    if (order.community_id != admin.default_community_id)
      return await globalMessages.notAuthorized(ctx, tgId);
  }
  ctx.deleteMessage();
  const solver = await User.findOne({ tg_id: tgId });
  if(solver === null)
    throw new Error("solver not found");
  if (dispute.status === 'RELEASED')
    return await messages.sellerReleased(ctx, solver);

  const buyer = await User.findOne({ _id: order.buyer_id });
  if(buyer === null)
    throw new Error("buyer not found");
  const seller = await User.findOne({ _id: order.seller_id });
  if(seller === null)
    throw new Error("seller not found");
  const initiator = order.buyer_dispute ? 'buyer' : 'seller';
  const buyerDisputes = await Dispute.count({
    $or: [{ buyer_id: buyer._id }, { seller_id: buyer._id }],
  });
  const sellerDisputes = await Dispute.count({
    $or: [{ buyer_id: seller._id }, { seller_id: seller._id }],
  });

  dispute.solver_id = solver.id;
  dispute.status = 'IN_PROGRESS';
  await dispute.save();
  await messages.disputeData(
    ctx,
    buyer,
    seller,
    order,
    initiator,
    solver,
    buyerDisputes,
    sellerDisputes
  );
};
