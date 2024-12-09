// @ts-check
import { IOrder } from '../../../models/order';
import * as Events from './index';

export const TYPES = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
};

export const orderCreated = (order: IOrder) => {
  Events.dispatch({
    type: TYPES.ORDER_CREATED,
    payload: order,
  });
};
export const onOrderCreated = (fn: Events.SubscriptionFunction) => Events.subscribe(TYPES.ORDER_CREATED, fn);

export const orderUpdated = (order: IOrder) => {
  Events.dispatch({
    type: TYPES.ORDER_UPDATED,
    payload: order,
  });
};
export const onOrderUpdated = (fn: Events.SubscriptionFunction) => Events.subscribe(TYPES.ORDER_UPDATED, fn);
