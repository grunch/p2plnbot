import { Telegraf } from "telegraf";
import { Config } from '../models';
import { CommunityContext } from "../bot/modules/community/communityContext";
import { logger } from '../logger';

const { getInfo } = require('../ln');

const info = async (bot: Telegraf<CommunityContext>) => {
  try {
    let config = await Config.findOne({});
    if (config === null) {
      config = new Config();
    }
    const info = await getInfo();
    if (info.is_synced_to_chain) {
      config.node_status = 'up';
    }
    config.node_uri = info.uris[0];
    await config.save();
  } catch (error) {
    const message = String(error);
    logger.error(`node info catch error: ${message}`);
  }
};

export default info;
