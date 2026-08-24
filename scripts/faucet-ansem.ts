/**
 * Dev-only $ANSEM faucet. Mints test $ANSEM to a wallet so claiming,
 * balances and reward flows are testable on devnet/localhost.
 *
 *   AMOUNT=1000000 npm run faucet:ansem
 *   AMOUNT=1000000 TARGET_WALLET=<browser address> npm run faucet:ansem:devnet
 *
 * On mainnet nobody holds the $ANSEM mint authority (it stays with the
 * CLI keypair used in launch-setup, and the reward vault is funded via
 * admin:fund instead). This is a test-only helper, same as faucet-ansemw.ts.
 *
 * AMOUNT is in whole $ANSEM (the mint has 6 decimals); default 1,000,000.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";

const T = (n: bigint) => n.toLocaleString("en-US");

describe("faucet:ansem", () => {
  it("mints test $ANSEM", async () => {
    const env = anchor.AnchorProvider.env();
    const local = env.connection.rpcEndpoint.includes("127.0.0.1");
    const level = local ? "processed" : "confirmed";
    anchor.setProvider(
      new anchor.AnchorProvider(env.connection, env.wallet, {
        commitment: level,
        preflightCommitment: level,
      })
    );
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const program = anchor.workspace.ansemWorldV4 as Program<AnsemWorldV4>;

    const configPda = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    )[0];
    const cfg = await program.account.globalConfig.fetch(configPda);
    const ansemMint = cfg.ansemMint as PublicKey;

    const target = process.env.TARGET_WALLET
      ? new PublicKey(process.env.TARGET_WALLET)
      : provider.wallet.publicKey;

    const whole = BigInt(Math.floor(Number(process.env.AMOUNT ?? "1000000")));
    if (whole <= 0n) throw new Error("AMOUNT must be a positive number");
    const base = whole * BigInt(1e6); // 6 decimals

    const payer = (provider.wallet as anchor.Wallet).payer;
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ansemMint,
      target
    );

    await mintTo(
      provider.connection,
      payer,
      ansemMint,
      ata.address,
      provider.wallet.publicKey,
      base
    );

    console.log(`\n  minted ${T(whole)} $ANSEM`);
    console.log("  to wallet ", target.toBase58());
    console.log("  token acct", ata.address.toBase58());
    console.log("  $ANSEM mint", ansemMint.toBase58());
  });
});
