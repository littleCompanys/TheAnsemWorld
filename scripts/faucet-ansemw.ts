/**
 * Dev-only $ANSEMW faucet. Mints test $ANSEMW to a wallet so staking,
 * activation and upgrades are exercisable on localhost.
 *
 *   AMOUNT=1000000 npm run faucet
 *   AMOUNT=1000000 TARGET_WALLET=<browser address> npm run faucet
 *
 * This exists only because a virgin launch leaves every wallet at 0 — on
 * mainnet you buy $ANSEMW on pump.fun instead, and nobody holds the mint
 * authority the way the local CLI keypair does here. It touches no program
 * state and changes nothing about how the protocol behaves in production.
 *
 * AMOUNT is in whole $ANSEMW (the mint has 6 decimals); default 1,000,000,
 * which clears the top stake tier with room to spare.
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

describe("faucet", () => {
  it("mints test $ANSEMW", async () => {
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
    const ansemwMint = cfg.ansemwMint as PublicKey;

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
      ansemwMint,
      target
    );

    // The seed created the mint with the CLI wallet as authority; only that
    // key can mint, which is exactly why this is a localhost-only tool.
    await mintTo(
      provider.connection,
      payer,
      ansemwMint,
      ata.address,
      provider.wallet.publicKey,
      base
    );

    console.log(`\n  minted ${T(whole)} $ANSEMW`);
    console.log("  to wallet ", target.toBase58());
    console.log("  token acct", ata.address.toBase58());
    console.log("  $ANSEMW mint", ansemwMint.toBase58());
  });
});
