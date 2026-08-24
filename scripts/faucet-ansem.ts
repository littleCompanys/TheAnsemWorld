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
  TOKEN_PROGRAM_ID,
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

    // Which token program owns $ANSEM decides the ATA address and how
    // every instruction below must be issued. It is not fixed: $ANSEM is
    // Token-2022 on mainnet, and launch-setup mints the devnet stand-in
    // as Token-2022 too so a rehearsal exercises the same program.
    // Defaulting to the classic program derives an address that cannot
    // exist for such a mint, and the failure reads as the opaque
    // TokenAccountNotFoundError rather than anything about programs.
    const mintAcct = await provider.connection.getAccountInfo(ansemMint);
    if (!mintAcct) {
      throw new Error(
        `the configured $ANSEM mint ${ansemMint.toBase58()} does not exist ` +
          "on this cluster - you are probably pointed at the wrong network."
      );
    }
    const tokenProgram = mintAcct.owner ?? TOKEN_PROGRAM_ID;

    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ansemMint,
      target,
      false,
      undefined,
      undefined,
      tokenProgram
    );

    await mintTo(
      provider.connection,
      payer,
      ansemMint,
      ata.address,
      provider.wallet.publicKey,
      base,
      [],
      undefined,
      tokenProgram
    );

    console.log(`\n  minted ${T(whole)} $ANSEM`);
    console.log("  to wallet ", target.toBase58());
    console.log("  token acct", ata.address.toBase58());
    console.log("  $ANSEM mint", ansemMint.toBase58());
    console.log("  token program", tokenProgram.toBase58());
  });
});
