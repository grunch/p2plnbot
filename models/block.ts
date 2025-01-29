import mongoose, { Document, Schema } from 'mongoose';

export interface IBlock extends Document {
  blocker_tg_id: string;
  blocked_tg_id: string;
  created_at: Date;
}

const blockSchema = new Schema<IBlock>({
  blocker_tg_id: { type: String },
  blocked_tg_id: { type: String },
  created_at: { type: Date, default: Date.now },
});

export default mongoose.model<IBlock>('Block', blockSchema);
