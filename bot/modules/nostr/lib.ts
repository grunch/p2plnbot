import Nostr from 'nostr-tools';

export const decodeNpub = (npub: string) => {
  try {
    const { type, data } = Nostr.nip19.decode(npub);
    if (type === 'npub') return data;
  } catch (err) {}
};
export const encodeNpub = (hex: string) => {
  return Nostr.nip19.npubEncode(hex);
};
