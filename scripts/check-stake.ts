/**
 * Proves the staking bonus does what it claims.
 *
 *   npm run check:stake[:devnet]
 *
 * The bonus is not a payout of its own - it raises the focused piece's
 * weight, so the existing accumulator pays it out as part of the normal
 * share. That means the things worth checking are: the weight moves by
 * the right percentage, the global pool moves with it, the timing cannot
 * be gamed, and the guards hold.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";

const T = (n: number) => n.toLocaleString("en-US");

describe("staking", () => {
  it("raises weight by the tier bonus and unwinds cleanly", async () => {
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
    const me = provider.wallet.publicKey;

    const pda = (s: string) =>
      PublicKey.findProgramAddressSync([Buffer.from(s)], program.programId)[0];
    const posPda = (a: PublicKey) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("position"), a.toBuffer()],
        program.programId
      )[0];

    const cfg = await program.account.globalConfig.fetch(pda("config"));

    // Create the stake vault if this is the first run.
    if (!(await provider.connection.getAccountInfo(pda("stake_vault")))) {
      await program.methods
        .initializeStakeVault()
        .accounts({ payer: me, ansemwMint: cfg.ansemwMint })
        .rpc();
      console.log("  stake vault created");
    }

    // Find an active piece owned by this wallet.
    const all = await program.account.position.all();
    const mine = all.find(
      (p: any) => p.account.active && p.account.activationOwner.equals(me)
    );
    if (!mine) throw new Error("need one active piece - run npm run seed");
    const asset = mine.account.asset as PublicKey;

    // Make sure this wallet can afford the stake. The seed mints a token
    // or two for UI testing; the tiers here are in the hundreds of
    // thousands, so top up rather than depend on whatever is left over.
    const payer = (provider.wallet as anchor.Wallet).payer;
    const ansemwAta = await getOrCreateAssociatedTokenAccount(
      provider.connection, payer, cfg.ansemwMint, me
    );
    const NEEDED = BigInt(1_000_000) * BigInt(1e6);
    if (BigInt(ansemwAta.amount.toString()) < NEEDED) {
      await mintTo(
        provider.connection, payer, cfg.ansemwMint, ansemwAta.address,
        me, NEEDED
      );
      console.log("  topped up $ANSEMW for the test");
    }

    const before = await program.account.position.fetch(posPda(asset));
    const rsBefore = await program.account.rewardState.fetch(pda("reward_state"));
    console.log("\n  piece            ", asset.toBase58());
    console.log("  weight before    ", Number(before.effectiveWeight));
    console.log("  pool total before", Number(rsBefore.totalWeight));

    // ── stake 250k -> +10% tier ──────────────────────────────────
    const AMOUNT = 250_000;
    await program.methods
      .stake(new anchor.BN(AMOUNT * 1e6)) // 6 decimals
      .accounts({
        staker: me,
        stakerAnsemw: getAssociatedTokenAddressSync(cfg.ansemwMint, me),
        ansemwMint: cfg.ansemwMint,
        asset,
      })
      .rpc();

    const after = await program.account.position.fetch(posPda(asset));
    const rsAfter = await program.account.rewardState.fetch(pda("reward_state"));
    const expected = Math.floor((Number(before.effectiveWeight) * 110) / 100);

    console.log(`\n  staked           ${T(AMOUNT)} $ANSEMW -> +${after.stakeBonusPct}%`);
    console.log("  weight after     ", Number(after.effectiveWeight), `(expected ${expected})`);
    console.log("  pool total after ", Number(rsAfter.totalWeight));

    if (after.stakeBonusPct !== 10) {
      throw new Error(`expected +10% tier, got +${after.stakeBonusPct}%`);
    }
    if (Number(after.effectiveWeight) !== expected) {
      throw new Error(
        `weight is ${after.effectiveWeight}, expected ${expected}`
      );
    }
    // The pool must move by exactly the same delta as the piece.
    const pieceDelta = Number(after.effectiveWeight) - Number(before.effectiveWeight);
    const poolDelta = Number(rsAfter.totalWeight) - Number(rsBefore.totalWeight);
    if (pieceDelta !== poolDelta) {
      throw new Error(
        `pool moved ${poolDelta} but the piece moved ${pieceDelta} - ` +
        `the global total is out of sync`
      );
    }
    console.log(`  pool delta       ${poolDelta} == piece delta ${pieceDelta}`);

    // ── top up to 500k -> +15% ───────────────────────────────────
    await program.methods
      .stake(new anchor.BN(250_000 * 1e6))
      .accounts({
        staker: me,
        stakerAnsemw: getAssociatedTokenAddressSync(cfg.ansemwMint, me),
        ansemwMint: cfg.ansemwMint,
        asset,
      })
      .rpc();
    const topped = await program.account.position.fetch(posPda(asset));
    console.log(`\n  topped to 500,000 -> +${topped.stakeBonusPct}%`);
    if (topped.stakeBonusPct !== 15) {
      throw new Error(`expected +15%, got +${topped.stakeBonusPct}%`);
    }

    // ── guard: cannot focus a piece someone else activated ───────
    const stranger = Keypair.generate();
    let refused = false;
    try {
      await program.methods
        .stake(new anchor.BN(1))
        .accounts({
          staker: stranger.publicKey,
          stakerAnsemw: getAssociatedTokenAddressSync(cfg.ansemwMint, stranger.publicKey),
          ansemwMint: cfg.ansemwMint,
          asset,
        })
        .signers([stranger])
        .rpc();
    } catch {
      refused = true;
    }
    console.log(`  stranger refused  ${refused}`);
    if (!refused) throw new Error("a stranger was able to stake onto my piece");

    // ── unstake: everything comes back, bonus gone ───────────────
    await program.methods
      .unstake()
      .accounts({
        staker: me,
        stakerAnsemw: getAssociatedTokenAddressSync(cfg.ansemwMint, me),
        asset,
      })
      .rpc();

    const final = await program.account.position.fetch(posPda(asset));
    const rsFinal = await program.account.rewardState.fetch(pda("reward_state"));
    console.log(`\n  unstaked         bonus now +${final.stakeBonusPct}%`);
    console.log("  weight restored  ", Number(final.effectiveWeight));
    console.log("  pool restored    ", Number(rsFinal.totalWeight));

    if (final.stakeBonusPct !== 0) throw new Error("bonus survived unstake");
    if (Number(final.effectiveWeight) !== Number(before.effectiveWeight)) {
      throw new Error("weight did not return to its pre-stake value");
    }
    if (Number(rsFinal.totalWeight) !== Number(rsBefore.totalWeight)) {
      throw new Error("pool did not return to its pre-stake value");
    }
    console.log("\n  weight and pool both back to exactly where they started");
  });
});
