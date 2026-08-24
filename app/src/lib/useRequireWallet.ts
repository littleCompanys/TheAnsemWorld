import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

/**
 * Pages show their content to everyone - the collection, the tiers, the
 * stats - so visitors can see what the project is before they ever plug
 * in a wallet. This is the gate that used to sit at the top of every
 * page instead, hiding all of that behind "connect your wallet".
 *
 * Call the returned function at the start of any action that needs a
 * signer. If no wallet is connected it opens the connect modal and
 * returns false so the caller bails out; otherwise it returns true and
 * the action proceeds exactly as before.
 */
export const useRequireWallet = () => {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  return (): boolean => {
    if (publicKey) return true;
    setVisible(true);
    return false;
  };
};
