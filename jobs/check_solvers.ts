import { Telegraf } from 'telegraf';
import { MainContext } from '../bot/start';

import { Community, User, } from '../models';
import { ICommunity } from '../models/community';
import { logger } from '../logger';
import { I18nContext } from '@grammyjs/i18n';
import { getUserI18nContext } from '../util';


const checkSolvers = async (bot: Telegraf<MainContext>) => {
  try {
    const communities = await Community.find();

    for (const community of communities) {
        if (community.solvers.length > 0) {
            continue;
        } else {
            await notifyAdmin(community, bot);
        }
    }
  } catch (error) {
    const message = String(error);
    logger.error(`checkSolvers catch error: ${message}`);
  }
};

const notifyAdmin = async (community: ICommunity, bot: Telegraf<MainContext>) => {
  community.messages_sent_count += 1;
  /**
   * The community is disabled if the admin has received the maximum notification message (MAX_MESSAGES - 1) to add a solver.
   */
  if (community.messages_sent_count >= Number(process.env.MAX_MESSAGES)) {
    await community.delete();

    logger.info(`Community: ${community.name} has been deleted due to lack of solvers.`);
    return;
  }

  await community.save();
  const admin = await User.findById(community.creator_id);

  if (admin) {
    const i18nCtx: I18nContext = await getUserI18nContext(admin);
    const remainingDays: number = (Number(process.env.MAX_MESSAGES) - 1) - community.messages_sent_count;

    const message = remainingDays === 0 ? i18nCtx.t('check_solvers_last_warning', { communityName: community.name }) : i18nCtx.t('check_solvers', { communityName: community.name, remainingDays: remainingDays });

    await bot.telegram.sendMessage(
      admin.tg_id,
      message,
    );
  }
}

export default checkSolvers;
