import { Telegraf } from "telegraf";

import { Order, Community } from '../models';
import { logger } from "../logger";
import { CommunityContext } from "../bot/modules/community/communityContext";

const deleteCommunity = async (bot: Telegraf<CommunityContext>) => {
  try {
    const communities = await Community.find();
    for (const community of communities) {
      // Delete communities with COMMUNITY_TTL days without a successful order
      const days = 86400 * Number(process.env.COMMUNITY_TTL);
      const time = new Date();
      time.setSeconds(time.getSeconds() - days);
      // If is a new community we don't do anything
      if (community.created_at > time) {
        continue;
      }
      const orders = await Order.count({
        created_at: { $gte: time },
        status: 'SUCCESS',
        community_id: community.id,
      });
      if (orders == 0) {
        logger.info(
          `Community: ${community.name} have ${process.env.COMMUNITY_TTL} days without a successfully completed order, it's being deleted!`
        );
        await community.delete();
      }
    }
  } catch (error) {
    const message = String(error);
    logger.error(`deleteCommunity catch error: ${message}`);
  }
};

export default deleteCommunity;
