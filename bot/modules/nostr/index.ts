import { logger } from '../../../logger';
import * as Config from './config';
import { createOrderEvent } from './events';
import * as Commands from './commands';
import { Telegraf } from 'telegraf';
import { IOrder } from '../../../models/order';
import { CommunityContext } from '../community/communityContext';

require('websocket-polyfill'); // is it needed?

export const configure = (bot: Telegraf<CommunityContext>) => {
  bot.command('/nostr', Commands.info);

  if (!Config.getRelays().length) {
    ['wss://nostr-pub.wellorder.net', 'wss://relay.damus.io'].map(
      Config.addRelay
    );
  }

  // I don't know why these requires are here and not at the top of the file, 
  // so I leave them as they are instead of converting to imports.
  const CommunityEvents = require('../events/community');
  CommunityEvents.onCommunityUpdated(async (community: any) => {
    // todo: notify users
  });

  const OrderEvents = require('../events/orders');

  OrderEvents.onOrderUpdated(async (order: IOrder) => {
    try {
      const event = await createOrderEvent(order);
      if (event) {
        await Promise.any(Config.pool.publish(Config.getRelays(), event));
      }

      return event;
    } catch (err) {
      logger.error(err);
    }
  });
};
