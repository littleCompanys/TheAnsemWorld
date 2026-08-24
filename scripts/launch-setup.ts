/**
 * Ground zero: create the protocol and nothing else.
 *
 *   npm run launch:setup[:devnet]
 *
 * This is what the seed is NOT. The seed fills a cluster with test
 * data - four minted pieces, free tokens, an active position, a funded
 * round - which is exactly wrong for a real launch. This creates only
 * what a launch needs and then closes minting:
 *
 *   - the two token mints ($ANSEM, $ANSEMW)
 *   - the Core collection, with the 5% royalty plugin
 *   - the protocol config, tier tables, fuse feed
 *   - collection authority moved to the program (so mint_nft can run)
 *   - paused: minting stays SHUT until you announce
 *
 * Zero pieces. Supply at 0. When you are ready, npm run mint:live.
 *
 * Token mints, split by cluster so a mainnet run can never point the
 * reward vault at a worthless throwaway (see the isMainnet check below):
 *
 *   devnet/local - test mints are created automatically. Pass ANSEM_MINT /
 *                  ANSEMW_MINT to reuse existing ones instead.
 *   mainnet      - ANSEM_MINT and ANSEMW_MINT are REQUIRED (the real
 *                  pump.fun addresses). The script refuses to run without
 *                  them rather than mint a fake $ANSEM on mainnet.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  createMint,
  getMint,
  getTransferFeeConfig,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";
import { makeUmi, waitForChain, toWeb3, createCollection, attachTokenMetadata } from "../tests/core-helpers";

/// The live $ANSEM on mainnet ("The Black Bull"). Already deployed and
/// not ours to create, so it is pinned here rather than passed in -
/// a typo'd reward mint is not something a launch should be able to do.
/// Token-2022, 6 decimals (verified at setup below).
const ANSEM_MAINNET_MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

const ACTIVATION_COST = 25_000;
const TIER_THRESHOLDS = [25_000, 75_000, 150_000, 300_000, 850_000];
const TIER_WEIGHTS = [100, 140, 190, 250, 350];
const FUSE_COSTS = [50_000, 100_000];
const MINT_PRICE_SOL = 0.1;
const MAX_SUPPLY = 3_333;

describe("launch:setup", () => {
  it("creates the protocol with minting closed", async () => {
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
    const payer = (provider.wallet as anchor.Wallet).payer;
    const me = provider.wallet.publicKey;
    const umi = makeUmi(provider.connection.rpcEndpoint, payer);
    await waitForChain(umi);

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")], program.programId
    );

    if (await program.account.globalConfig.fetchNullable(configPda)) {
      throw new Error(
        "protocol already initialized on this cluster - nothing to set up"
      );
    }

    // Mint revenue and the 5% royalty both go straight to the authority
    // wallet. That matches the intended flow - revenue lands with the
    // dev, who funds the reward pool from it with fund_rewards - and it
    // avoids a trap in the program: withdraw_treasury sends the Treasury
    // PDA's balance to config.treasury, so making config.treasury the PDA
    // itself would mean withdrawing to the same account it drains, a
    // no-op. The wallet is the correct destination.
    const collection = await createCollection(umi, me);
    console.log("  collection created with 5% royalty to the authority wallet");

    // Two token mints: $ANSEM (reward) and $ANSEMW (burn/stake). How they
    // are resolved depends entirely on the cluster, and the split is a
    // safety rail, not a convenience:
    //
    //   devnet/local  → throwaway test mints created here (unless supplied),
    //                   because mainnet tokens cannot be mirrored to devnet.
    //                   You own them, so you can mint freely to test.
    //
    //   mainnet       → NEVER create tokens. Both must be the real pump.fun
    //                   addresses, supplied via ANSEM_MINT / ANSEMW_MINT.
    //                   Creating a throwaway $ANSEM on mainnet would point
    //                   the reward vault at a worthless token — so we refuse.
    const endpoint = provider.connection.rpcEndpoint;
    const isLocal = endpoint.includes("127.0.0.1") || endpoint.includes("localhost");
    const isDevnet = endpoint.includes("devnet");
    const isMainnet = !isLocal && !isDevnet;

    let ansemMint: PublicKey;
    let ansemwMint: PublicKey;
    // Each mint's owning token program. Not a constant: the program
    // accepts either SPL Token or Token-2022, and every instruction
    // that touches a token must be handed the one that actually owns
    // that mint.
    let ansemTokenProgram: PublicKey;
    let ansemwTokenProgram: PublicKey;

    if (isMainnet) {
      // $ANSEM already exists and is not ours to create, so it is
      // baked in rather than supplied per-run. $ANSEMW is minted on
      // the launchpad at launch time, so it stays required.
      ansemMint = new PublicKey(process.env.ANSEM_MINT ?? ANSEM_MAINNET_MINT);
      if (!process.env.ANSEMW_MINT) {
        throw new Error(
          "MAINNET launch requires ANSEMW_MINT (the real mint address " +
            "from the launchpad). Refusing to create a throwaway token " +
            "on mainnet — that would point activation at a worthless mint."
        );
      }
      ansemwMint = new PublicKey(process.env.ANSEMW_MINT);

      // These mints are created by someone else, so neither their
      // decimals nor their token program are ours to choose - and both
      // matter. Decimals: the program assumes 6 in state.rs
      // (ANSEMW_DECIMALS, which scales the stake-bonus thresholds) and
      // the frontend assumes 6 in program.ts, and a mismatch fails
      // silently rather than loudly - wrong stake tiers for everyone,
      // wrong balances everywhere. Token program: $ANSEM is Token-2022,
      // and each mint's program has to be passed to every instruction
      // that touches it, so it gets read here and reported rather than
      // assumed. Refuse the launch on anything unexpected, while the
      // config can still be fixed.
      const EXPECTED_DECIMALS = 6;
      const detected: PublicKey[] = [];
      for (const [label, mint] of [
        ["$ANSEM", ansemMint],
        ["$ANSEMW", ansemwMint],
      ] as const) {
        const acct = await provider.connection.getAccountInfo(mint);
        if (!acct) {
          throw new Error(`${label} mint ${mint.toBase58()} does not exist.`);
        }
        const owner = acct.owner;
        const isClassic = owner.equals(TOKEN_PROGRAM_ID);
        const is2022 = owner.equals(TOKEN_2022_PROGRAM_ID);
        if (!isClassic && !is2022) {
          throw new Error(
            `${label} mint ${mint.toBase58()} is owned by ${owner.toBase58()}, ` +
              `which is neither the SPL Token nor the Token-2022 program.`
          );
        }
        const info = await getMint(provider.connection, mint, undefined, owner);
        if (info.decimals !== EXPECTED_DECIMALS) {
          throw new Error(
            `${label} mint ${mint.toBase58()} has ${info.decimals} decimals, ` +
              `but this program is built for ${EXPECTED_DECIMALS}. Update ` +
              `ANSEMW_DECIMALS in programs/ansem-world-v4/src/state.rs and ` +
              `DECIMALS in app/src/lib/program.ts (and redeploy) before ` +
              `launching against this mint.`
          );
        }
        // A Token-2022 transfer fee would silently break the books.
        // Every transfer_checked delivers less than it sends, but the
        // program records the amount it asked for: a staked balance
        // the vault never actually received (unstake then tries to
        // return more than is there), and a reward round credited at
        // more $ANSEM than the vault holds (claims fail once the
        // shortfall catches up). Burns are unaffected, so activation
        // would still work while staking and rewards quietly rot.
        // Neither is recoverable after launch, so refuse now.
        const feeCfg = is2022 ? getTransferFeeConfig(info) : null;
        const bps = feeCfg?.newerTransferFee.transferFeeBasisPoints ?? 0;
        if (feeCfg && bps > 0) {
          throw new Error(
            `${label} mint ${mint.toBase58()} charges a ${bps} bps Token-2022 ` +
              `transfer fee. This protocol's staking and reward accounting ` +
              `assume the amount sent equals the amount received, so it ` +
              `cannot be launched against a fee-bearing mint without ` +
              `reworking that accounting first.`
          );
        }
        if (info.freezeAuthority) {
          console.log(
            `  WARNING: ${label} has a freeze authority ` +
              `(${info.freezeAuthority.toBase58()}) - that key can freeze ` +
              `holder accounts, blocking claims and unstakes.`
          );
        }

        detected.push(owner);
        console.log(
          `  ${label} verified: ${info.decimals} decimals, ` +
            `${is2022 ? "Token-2022" : "SPL Token"} (${owner.toBase58()})`
        );
      }
      [ansemTokenProgram, ansemwTokenProgram] = detected;

      console.log("  $ANSEM  mint:", ansemMint.toBase58(), "(real)");
      console.log("  $ANSEMW mint:", ansemwMint.toBase58(), "(real, supplied)");
    } else {
      const ansemIsThrowaway = !process.env.ANSEM_MINT;
      const ansemwIsThrowaway = !process.env.ANSEMW_MINT;

      // Created as Token-2022 so a devnet rehearsal exercises the same
      // token program the real $ANSEM uses on mainnet.
      ansemMint = process.env.ANSEM_MINT
        ? new PublicKey(process.env.ANSEM_MINT)
        : await createMint(
            provider.connection, payer, me, null, 6,
            undefined, undefined, TOKEN_2022_PROGRAM_ID
          );
      ansemwMint = process.env.ANSEMW_MINT
        ? new PublicKey(process.env.ANSEMW_MINT)
        : await createMint(
            provider.connection, payer, me, null, 6,
            undefined, undefined, TOKEN_2022_PROGRAM_ID
          );
      // Supplied mints may use either program, so read rather than assume.
      ansemTokenProgram =
        (await provider.connection.getAccountInfo(ansemMint))?.owner ??
        TOKEN_2022_PROGRAM_ID;
      ansemwTokenProgram =
        (await provider.connection.getAccountInfo(ansemwMint))?.owner ??
        TOKEN_2022_PROGRAM_ID;
      console.log(
        "  $ANSEM  mint:",
        ansemMint.toBase58(),
        ansemIsThrowaway ? "(test throwaway)" : "(supplied)"
      );
      console.log(
        "  $ANSEMW mint:",
        ansemwMint.toBase58(),
        ansemwIsThrowaway ? "(test throwaway)" : "(supplied)"
      );

      // Bare SPL mints have no name/symbol/image - wallets fall back to
      // "SPL Token" without a Metadata account. Only attach one to mints
      // this script itself just created: a supplied mint may already
      // carry real metadata (or, on mainnet, belong to pump.fun, which
      // this branch never runs for anyway), and this identity's mint
      // authority wouldn't be able to write to it either way.
      if (ansemIsThrowaway) {
        await attachTokenMetadata(umi, ansemMint, "Ansem (test)", "ANSEM", "https://example.com/ansem.json");
        console.log("  $ANSEM  metadata attached (test)");
      }
      if (ansemwIsThrowaway) {
        await attachTokenMetadata(umi, ansemwMint, "Ansem World (test)", "ANSEMW", "https://example.com/ansemw.json");
        console.log("  $ANSEMW metadata attached (test)");
      }
    }

    await program.methods
      .initializeProtocol({
        coreCollection: toWeb3(collection.publicKey),
        treasury: me,
        activationCost: new anchor.BN(ACTIVATION_COST),
        tierThresholds: TIER_THRESHOLDS.map((v) => new anchor.BN(v)),
        tierWeights: TIER_WEIGHTS.map((v) => new anchor.BN(v)),
        fuseCosts: FUSE_COSTS.map((v) => new anchor.BN(v)),
        mintPrice: new anchor.BN(Math.round(MINT_PRICE_SOL * 1e9)),
        maxSupply: MAX_SUPPLY,
      })
      // The reward vault is created here as an account of the $ANSEM
      // mint, so this has to be $ANSEM's own program (Token-2022 on
      // mainnet), not a hardcoded classic-token id.
      .accounts({
        authority: me,
        ansemMint,
        ansemwMint,
        tokenProgram: ansemTokenProgram,
      })
      .rpc();
    console.log("  protocol initialized");

    // fuse() writes into this; create it now so nothing has to later.
    await program.methods
      .initializeFuseFeed()
      .accounts({ payer: me })
      .rpc();
    console.log("  fuse feed created");

    // Lock all minting behind the program.
    await program.methods
      .claimCollectionAuthority()
      .accounts({ authority: me, collection: toWeb3(collection.publicKey) })
      .rpc();
    console.log("  collection authority moved to the program");

    // Shut until you announce.
    await program.methods.setPaused(true).accounts({ authority: me }).rpc();
    console.log("  minting CLOSED (paused)");

    const cfg = await program.account.globalConfig.fetch(configPda);
    console.log("\n  ── ground zero ─────────────────────────────");
    console.log("  cluster       ", provider.connection.rpcEndpoint);
    console.log("  program       ", program.programId.toBase58());
    console.log("  collection    ", cfg.coreCollection.toBase58());
    console.log("  treasury      ", cfg.treasury.toBase58(), "(authority wallet)");
    console.log("  mint price    ", Number(cfg.mintPrice) / 1e9, "SOL");
    console.log("  supply        ", Number(cfg.currentSupply), "/", Number(cfg.maxSupply));
    console.log("  minting       ", cfg.paused ? "CLOSED" : "LIVE");
    const suffix = isMainnet ? ":mainnet" : local ? "" : ":devnet";
    console.log("\n  when you announce:  npm run mint:live" + suffix);
  });
});
