import mongoose, { Document, Schema } from 'mongoose';

export interface IOrder extends Document {
  description?: string;
  amount: number;
  max_amount: number;
  min_amount: number;
  fee: number;
  bot_fee: number;
  community_fee: number;
  routing_fee: number;
  hash: string | null;
  secret: string | null;
  creator_id: string;
  seller_id: string | null;
  buyer_id: string | null;
  buyer_invoice: string;
  buyer_dispute_token: string;
  seller_dispute_token: string;
  buyer_dispute: boolean
  seller_dispute: boolean
  buyer_cooperativecancel: boolean;
  seller_cooperativecancel: boolean;
  canceled_by: string
  action_by: string
  previous_dispute_status: string;
  status: string;
  type: string;
  fiat_amount?: number;
  fiat_code: string;
  payment_method: string;
  created_at: Date;
  invoice_held_at: Date;
  taken_at: Date | null;
  tg_chat_id: string;
  tg_order_message: string;
  tg_channel_message1: string | null;
  range_parent_id: string;
  price_from_api: boolean;
  price_margin: number;
  calculated: boolean;
  admin_warned: boolean;
  paid_hold_buyer_invoice_updated: boolean;
  community_id: string;
  is_frozen: boolean;
  is_public: boolean;
  random_image: string;
}

const orderSchema = new Schema<IOrder>({
  description: { type: String, required: true },
  amount: {
    // amount in satoshis
    type: Number,
    min: 0,
  },
  max_amount: {
    // max amount in fiat
    type: Number,
    min: 0,
  },
  min_amount: {
    // min amount in fiat
    type: Number,
    min: 0,
  },
  fee: { type: Number, min: 0 },
  bot_fee: { type: Number, min: 0 }, // bot MAX_FEE at the moment of order creation
  community_fee: { type: Number, min: 0 }, // community FEE_PERCENT at the moment of order creation
  routing_fee: { type: Number, min: 0, default: 0 },
  hash: {
    type: String,
    index: {
      unique: true,
      partialFilterExpression: { hash: { $type: 'string' } },
    },
  }, // hold invoice hash
  secret: {
    type: String,
    index: {
      unique: true,
      partialFilterExpression: { secret: { $type: 'string' } },
    },
  }, // hold invoice secret
  creator_id: { type: String },
  seller_id: { type: String },
  buyer_id: { type: String },
  buyer_invoice: { type: String },
  buyer_dispute_token: { type: String },
  seller_dispute_token: { type: String },
  buyer_dispute: { type: Boolean, default: false },
  seller_dispute: { type: Boolean, default: false },
  buyer_cooperativecancel: { type: Boolean, default: false },
  seller_cooperativecancel: { type: Boolean, default: false },
  canceled_by: { type: String },
  action_by: { type: String },
  previous_dispute_status: {
    type: String,
    enum: [
      'ACTIVE', //  order taken
      'FIAT_SENT', // buyer indicates the fiat payment is already done
    ],
  },
  status: {
    type: String,
    enum: [
      'WAITING_PAYMENT', // buyer waiting for seller pay hold invoice
      'WAITING_BUYER_INVOICE', // seller waiting for buyer add invoice where will receive sats
      'PENDING', // order published on CHANNEL but not taken yet
      'ACTIVE', //  order taken
      'FIAT_SENT', // buyer indicates the fiat payment is already done
      'CLOSED', // order closed
      'DISPUTE', // one of the parties started a dispute
      'CANCELED',
      'SUCCESS',
      'PAID_HOLD_INVOICE', // seller released funds
      'CANCELED_BY_ADMIN',
      'EXPIRED', // Expired orders, stated changed by a job
      'COMPLETED_BY_ADMIN',
      'FROZEN',
    ],
  },
  type: { type: String },
  fiat_amount: { type: Number, min: 1 }, // amount in fiat
  fiat_code: { type: String },
  payment_method: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  invoice_held_at: { type: Date },
  taken_at: { type: Date },
  tg_chat_id: { type: String },
  tg_order_message: { type: String },
  tg_channel_message1: { type: String },
  range_parent_id: { type: String }, // If the order have a parent we save the Id
  price_from_api: { type: Boolean },
  price_margin: { type: Number, default: 0 },
  calculated: { type: Boolean, default: false },
  admin_warned: { type: Boolean, default: false }, // We set this to true when the bot warns admins the order is about to expire
  paid_hold_buyer_invoice_updated: { type: Boolean, default: false }, // We set this to true when buyer executes /setinvoice on a order PAID_HOLD_INVOICE
  community_id: { type: String },
  is_public: { type: Boolean, default: true },
  is_frozen: { type: Boolean, default: false },
  random_image: { type: String },
});

export default mongoose.model<IOrder>('Order', orderSchema);
