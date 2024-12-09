import mongoose, { Document, Schema } from 'mongoose';

export interface IDispute extends Document {
  initiator: string;
  seller_id: string | null;
  buyer_id: string | null;
  status: string;
  community_id: string;
  order_id: string;
  solver_id: string;
  created_at: Date;
}

const DisputeSchema = new Schema<IDispute>({
  initiator: { type: String, required: true },
  seller_id: { type: String },
  buyer_id: { type: String },
  status: {
    type: String,
    enum: [
      'WAITING_FOR_SOLVER',
      'IN_PROGRESS', // taken by a solver
      'SETTLED', // settled seller's invoice by admin/solver and started to pay sats to buyer
      'SELLER_REFUNDED', // canceled by admin/solver and refunded to seller
      'RELEASED', // release by the seller
    ],
  },
  community_id: { type: String, default: null },
  order_id: { type: String, default: null },
  solver_id: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model<IDispute>('Dispute', DisputeSchema);
