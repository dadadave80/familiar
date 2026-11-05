const paid =
  "That was a real transaction; the Post Office paid the fee for you.";
export const receipts = {
  keep_google: {
    sentence:
      "Your player pass is kept with Google. Your original browser pass still works.",
    detail:
      "Google proved its recovery key before that key received access to your player account. The pet’s account stays keyless; your player paid a small testnet fee.",
  },
  recover_google: {
    sentence: "Welcome back. This browser can guide your companion again.",
    detail:
      "Your Google pass restored access to the existing player account. This browser’s previous guest pass stays saved as a backup; the pet’s belongings stay in its own account.",
  },
  cancel_listing: {
    sentence: "Your pet’s adoption notice has been taken down.",
    detail: paid,
  },
  adopt: {
    sentence: "Your pet has a home of its own: a real, named NEAR account.",
    detail:
      "The adoption certificate is an NFT. Whoever owns it may guide this pet.",
  },
  feed: {
    sentence: "A full belly, a better mood. Your pet’s care was recorded.",
    detail: paid,
  },
  forage: {
    sentence:
      "A small errand, something useful brought home. The supplies belong to your pet.",
    detail: paid,
  },
  craft: {
    sentence:
      "Flour and water became bread. The recipe settled in one inventory update.",
    detail: paid,
  },
  sleep: {
    sentence: "Your pet put its own savings to work while it naps.",
    detail:
      "This is real staking on NEAR testnet. The pool balance includes any rewards.",
  },
  wake: {
    sentence:
      "Your pet is waking up. Its savings are waiting through the pool’s release period.",
    detail:
      "Unstaking takes four epochs; the pool decides when withdrawal is available.",
  },
  withdraw: {
    sentence: "The nap savings are back in your pet’s account.",
    detail: "Savings stay with the pet even if someone else adopts it.",
  },
  sell_to_npc: {
    sentence: "Bram bought your supplies. The earnings belong to your pet.",
    detail:
      "A 2% market fee supports a den. Bram’s pricing key cannot spend his funds.",
  },
  buy_from_npc: {
    sentence: "Bram packed your order. Your pet paid with its own savings.",
    detail:
      "A 2% market fee supports a den; the supplies are held by your pet’s account.",
  },
  join_den: {
    sentence: "Your pet found its people. Welcome to the den.",
    detail: paid,
  },
  list: {
    sentence: "Your pet’s adoption notice is posted at the agreed price.",
    detail: "The sale includes the pet’s account, inventory and savings.",
  },
  buy_pet: {
    sentence: "A new companion, with its whole little life intact.",
    detail:
      "The pet’s NFT changed hands. Its account, inventory and savings stayed together.",
  },
  nft_transfer: {
    sentence: "Your pet’s adoption certificate changed hands.",
    detail:
      "Only the current NFT owner can guide the pet. The pet’s belongings stay with it.",
  },
  nft_revoke: {
    sentence: "The market’s permission to transfer your pet was removed.",
    detail: paid,
  },
  claim: {
    sentence: "Your market earnings have been collected.",
    detail: paid,
  },
  claim_market: {
    sentence: "Your pet collected its market earnings into its own account.",
    detail: paid,
  },
} satisfies Record<string, { sentence: string; detail: string }>;

export function receiptFor(key: string) {
  return (
    receipts[key as keyof typeof receipts] ?? {
      sentence: "Your action was confirmed on NEAR testnet.",
      detail: paid,
    }
  );
}
export function explorerLink(hash: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)
    ? `https://testnet.nearblocks.io/txns/${hash}`
    : null;
}
const errors: Record<string, string> = {
  ERR_NOT_OWNER:
    "This pet’s owner changed. Refresh the town to see your companions.",
  ERR_NAME:
    "Try a name with 2–24 lowercase letters or numbers. Single hyphens or underscores can join them.",
  ERR_NAME_TAKEN: "That name already has a companion. Try another.",
  ERR_ENERGY: "Time for a rest. One errand returns every eight hours.",
  ERR_LEVEL: "A little more time together will open this part of town.",
  ERR_FEED_COOLDOWN: "Still chewing. Try feeding again in half a minute.",
  ERR_SLEEPING: "Your pet is having a nap. Wake it before sending it out.",
  ERR_UNBONDING:
    "The pool is still releasing those savings. Check again after the remaining epochs.",
  ERR_RESERVE:
    "Leave a little in your pet’s account for its home. Choose a smaller amount.",
  ERR_NPC_BROKE:
    "Bram is short of savings. Your supplies are safe; try again later.",
  ERR_PET_BUSY: "Your pet is finishing its last errand. Refresh in a moment.",
  ERR_BALANCE:
    "There are not enough supplies for that yet. Try an errand first.",
  ERR_QUOTE: "Bram’s price changed. Refresh the stall before trying again.",
  ERR_ACTION_FAILED:
    "That errand did not finish. Refresh your pet to check its confirmed supplies and savings.",
  QUOTA: "The Post Office is out of stamps; back in a minute.",
  ERR_QUOTA: "The Post Office is out of stamps; back in a minute.",
};
export function errorCopy(code: string) {
  return (
    errors[code] ??
    "The Post Office could not confirm delivery. Check your pet before trying again."
  );
}
