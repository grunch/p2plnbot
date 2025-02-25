import mongoose, { Document, Schema, Types } from 'mongoose';

const CURRENCIES: number = parseInt(process.env.COMMUNITY_CURRENCIES || '10');

const arrayLimits = (val: any[]): boolean => {
    return val.length > 0 && val.length <= 2;
};

const currencyLimits = (val: string): boolean => {
    return val.length > 0 && val.length <= CURRENCIES;
};


export interface IOrderChannel extends Document {
    name: string;
    type: string;
}

const OrderChannelSchema = new Schema<IOrderChannel>({
    name: { type: String, required: true, trim: true },
    type: {
        type: String,
        enum: ['buy', 'sell', 'mixed'],
    },
});

export interface IUsernameId extends Document {
    id: string;
    username: string;
}

const usernameIdSchema = new Schema<IUsernameId>({
    id: { type: String, required: true },
    username: { type: String, required: true, trim: true },
});

export interface ICommunity extends Document {
    name: string;
    creator_id: string;
    group: string;
    order_channels: Types.DocumentArray<IOrderChannel>;
    fee: number;
    earnings: number;
    orders_to_redeem: number;
    dispute_channel: string;
    solvers: Types.DocumentArray<IUsernameId>;
    banned_users: Types.DocumentArray<IUsernameId>;
    public: boolean;
    currencies: Array<string>;
    created_at: Date;
    nostr_public_key: string;
    messages_sent_count: number;
}

const CommunitySchema = new Schema<ICommunity>({
    name: {
        type: String,
        unique: true,
        maxlength: 30,
        trim: true,
        required: true,
    },
    creator_id: { type: String },
    group: { type: String, trim: true }, // group Id or public name
    order_channels: {
        // array of Id or public name of channels
        type: [OrderChannelSchema],
        validate: [arrayLimits, '{PATH} is not within limits'],
    },
    fee: { type: Number, min: 0, max: 100, default: 0 },
    earnings: { type: Number, default: 0 }, // Sats amount to be paid to the community
    orders_to_redeem: { type: Number, default: 0 }, // Number of orders calculated to be redeemed
    dispute_channel: { type: String }, // Id or public name, channel to send new disputes
    solvers: [usernameIdSchema], // users that are dispute solvers
    banned_users: [usernameIdSchema], // users that are banned from the community
    public: { type: Boolean, default: true },
    currencies: {
        type: [String],
        required: true,
        trim: true,
        validate: [currencyLimits, '{PATH} is not within limits'],
    },
    created_at: { type: Date, default: Date.now },
    nostr_public_key: { type: String },
    messages_sent_count: { type: Number, default: 0 },
});


export default mongoose.model<ICommunity>('Community', CommunitySchema);
