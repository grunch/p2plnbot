// @ts-check
import { ICommunity } from '../../../models/community';
import * as Events from './index';
import { TYPES as ORDER_TYPES } from './orders';

export const TYPES = {
  COMMUNITY_UPDATED: 'COMMUNITY_UPDATED',
};

export const communityUpdated = (community: ICommunity) => {
  Events.dispatch({
    type: ORDER_TYPES.ORDER_CREATED,
    payload: community,
  });
};
export const onCommunityUpdated = (fn: Events.SubscriptionFunction) => Events.subscribe(ORDER_TYPES.ORDER_CREATED, fn);
