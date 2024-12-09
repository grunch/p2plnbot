export type SubscriptionFunction = (arg: any) => any;

export interface Event {
  type: string;
  payload: any;
}

interface Subscriptions {
  [name: string]: SubscriptionFunction[];
}

const subs: Subscriptions = {};

export const subscribe = (type: any, fn: SubscriptionFunction) => {
  subs[type] = subs[type] || [];
  subs[type].push(fn);
  return () => {
    subs[type] = subs[type].filter(sub => sub !== fn);
  };
};

export const dispatch = (event: Event) => {
  const fns = subs[event.type] || [];
  const results = fns.map(fn => fn(event.payload));
  return Promise.all(results);
};
