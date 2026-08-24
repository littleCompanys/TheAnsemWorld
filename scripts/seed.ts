/**
 * Fills a local validator with everything the site needs to be worth
 * looking at: the two mints, a Core collection, an initialized
 * protocol, a handful of NFTs, and a funded reward round.
 *
 * Point it at the wallet you will actually connect with:
 *   TARGET_WALLET=<your phantom address> npm run seed
 *
 * Without that it seeds the local CLI keypair, which is fine for
 * scripted checks but leaves the browser empty.
 *
 * Defaults are intentionally virgin: no NFTs, no activation, no reward
 * round, mint paused. For the old demo fill:
 *   SEED_DEMO=1 TARGET_WALLET=... npm run seed
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";
import {
  makeUmi,
  waitForChain,
  toWeb3,
  createCollection,
  mintAsset,
  transferAsset,
  attachTokenMetadata,
} from "../tests/core-helpers";

const ACTIVATION_COST = 25_000;
const TIER_THRESHOLDS = [25_000, 75_000, 150_000, 300_000, 850_000];
const TIER_WEIGHTS = [100, 140, 190, 250, 350];
const FUSE_COSTS = [50_000, 100_000];
/** Demo mode mints pieces and funds a round; default is 0 (virgin). */
const PIECES = process.env.SEED_DEMO === "1" ? Number(process.env.SEED_PIECES ?? 4) : 0;
const SEED_DEMO = process.env.SEED_DEMO === "1";

// Where the NFT metadata lives. Baked into each asset at mint time, so
// it has to be reachable by anyone - a localhost URL leaves the piece
// blank in every wallet and explorer. Override with METADATA_BASE_URI.
const METADATA_BASE_URI =
  process.env.METADATA_BASE_URI ??
  "https://secret-herring-7tg9l.lighthouseweb3.xyz/ipfs/bafybeib2kh3ztgx4prmx45uvvvino7j7r6hzcjsokqydb2ws7dhmyhkzn4";

describe("seed", () => {
  it("populates the local cluster", async () => {
    const envProvider = anchor.AnchorProvider.env();
    // "processed" is fine against a local validator, where every send
    // lands instantly. Public devnet RPCs rate-limit hard and drop
    // blockhashes, so confirmations there need the stronger level or
    // transactions expire mid-seed.
    const isLocal = envProvider.connection.rpcEndpoint.includes("127.0.0.1");
    const level = isLocal ? "processed" : "confirmed";
    anchor.setProvider(
      new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
        commitment: level,
        preflightCommitment: level,
      })
    );
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const program = anchor.workspace.ansemWorldV4 as Program<AnsemWorldV4>;
    const payer = (provider.wallet as anchor.Wallet).payer;

    const target = process.env.TARGET_WALLET
      ? new PublicKey(process.env.TARGET_WALLET)
      : provider.wallet.publicKey;

    const umi = makeUmi(provider.connection.rpcEndpoint, payer);
    await waitForChain(umi);

    console.log("\n  seeding for wallet:", target.toBase58());

    // Give the target wallet SOL so it can pay for its own actions.
    if (!target.equals(provider.wallet.publicKey)) {
      const sig = await provider.connection.requestAirdrop(
        target,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "processed");
    }

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")], program.programId
    );
    const existing = await program.account.globalConfig.fetchNullable(configPda);

    // Only mint the collection and the two tokens on a first run.
    // Re-running used to create a throwaway collection every time:
    // the protocol keeps pointing at the original, so the new one was
    // dead on arrival - three transactions of pure waste, and on a
    // rate-limited devnet RPC the most likely one to blow the run up.
    if (existing) {
      console.log("  protocol already initialized - reusing it");
    } else {
      // Royalties are paid to the program's treasury PDA, so secondary
      // sales land in the same vault as mint revenue and leave it only
      // through withdraw_treasury. The plugin can never be changed after
      // this, so the destination is decided here for good.
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury")], program.programId
      );
      const collection = await createCollection(umi, treasuryPda);
      const ansemMint = await createMint(
        provider.connection, payer, provider.wallet.publicKey, null, 6
      );
      const ansemwMint = await createMint(
        provider.connection, payer, provider.wallet.publicKey, null, 6
      );
      // Same reason as launch-setup.ts: a bare SPL mint has no
      // name/symbol/image, so wallets show it as generic "SPL Token".
      // These are always test throwaways here - seed.ts has no mainnet
      // branch - so attaching metadata is safe unconditionally.
      await attachTokenMetadata(umi, ansemMint, "Ansem (test)", "ANSEM", "https://example.com/ansem.json");
      await attachTokenMetadata(umi, ansemwMint, "Ansem World (test)", "ANSEMW", "https://example.com/ansemw.json");
      console.log("  token metadata attached (test)");
      await program.methods
        .initializeProtocol({
          coreCollection: toWeb3(collection.publicKey),
          treasury: provider.wallet.publicKey,
          activationCost: new anchor.BN(ACTIVATION_COST),
          tierThresholds: TIER_THRESHOLDS.map((n) => new anchor.BN(n)),
          tierWeights: TIER_WEIGHTS.map((n) => new anchor.BN(n)),
          fuseCosts: FUSE_COSTS.map((n) => new anchor.BN(n)),
          mintPrice: new anchor.BN(50_000_000), // 0.05 SOL
          maxSupply: 3_333,
        })
        .accounts({
          authority: provider.wallet.publicKey,
          ansemMint,
          ansemwMint,
        })
        .rpc();
      console.log("  protocol initialized");
    }

    const cfg = await program.account.globalConfig.fetch(configPda);
    const liveCollection = cfg.coreCollection as PublicKey;

    // Demo/dev only: free $ANSEMW so activate/upgrade/stake are testable
    // without pump.fun. Virgin launch leaves wallets at 0.
    const targetAnsemw = await createAssociatedTokenAccount(
      provider.connection, payer, cfg.ansemwMint, target
    ).catch(() => getAssociatedTokenAddressSync(cfg.ansemwMint, target));
    if (SEED_DEMO) {
      // 1,000,000 whole $ANSEMW (atomic units = whole * 10^decimals).
      // Activation alone costs 25,000; fusing costs up to 100,000 more -
      // this needs to comfortably cover activate + upgrade + fuse for a
      // handful of demo pieces, not just one activation.
      const topUpWhole = 1_000_000;
      await mintTo(
        provider.connection, payer, cfg.ansemwMint, targetAnsemw,
        provider.wallet.publicKey, topUpWhole * 10 ** 6
      );
      console.log(`  topped up ${topUpWhole.toLocaleString("en-US")} $ANSEMW for testing`);
    }

    // Mint pieces into the target wallet and register each one.
    const assets: PublicKey[] = [];
    if (PIECES > 0) {
      // Read current supply so names are sequential even on re-runs.
      let supplyBefore = 0;
      try {
        const cfgNow = await (program.account as any).globalConfig.fetch(configPda);
        supplyBefore = (cfgNow.currentSupply as any).toNumber?.() ?? cfgNow.currentSupply;
      } catch {}

      for (let i = 0; i < PIECES; i++) {
        const pieceNumber = supplyBefore + i + 1;
        const name = `The Ansem World #${pieceNumber}`;
        const uri = `${METADATA_BASE_URI}/${pieceNumber}.json`;

        if (cfg.collectionClaimed) {
          // Authority already moved to the config PDA. Umi cannot sign
          // for a PDA, so go in through the program's own mint - which
          // is the same path a real buyer takes. mint_nft creates the
          // Position itself.
          const asset = Keypair.generate();
          await program.methods
            .mintNft(name, uri)
            .accounts({
              buyer: provider.wallet.publicKey,
              asset: asset.publicKey,
              collection: liveCollection,
              treasury: cfg.treasury,
            })
            .signers([asset])
            .rpc();
          assets.push(asset.publicKey);

          if (!target.equals(provider.wallet.publicKey)) {
            await transferAsset(
              umi,
              { publicKey: asset.publicKey.toBase58() as any },
              { publicKey: liveCollection.toBase58() as any },
              umi.identity,
              target
            );
          }
        } else {
          // First seed: the deployer still holds the collection
          // authority, so Umi can mint directly.
          const asset = await mintAsset(
            umi,
            { publicKey: liveCollection.toBase58() as any },
            target,
            name,
            uri
          );
          const key = toWeb3(asset.publicKey);
          assets.push(key);
          await program.methods
            .initializePosition()
            .accounts({ payer: provider.wallet.publicKey, asset: key })
            .rpc();
        }
      }
      console.log(`  minted ${PIECES} pieces with positions`);
    } else {
      console.log("  no pieces minted (virgin seed — set SEED_DEMO=1 for demo fill)");
    }

    // The fuse feed lives in its own account, created once. fuse()
    // cannot run without it.
    const [fuseFeedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fuse_feed")], program.programId
    );
    if (!(await provider.connection.getAccountInfo(fuseFeedPda))) {
      await program.methods
        .initializeFuseFeed()
        .accounts({ payer: provider.wallet.publicKey })
        .rpc();
      console.log("  fuse feed created");
    }

    const [stakeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault")], program.programId
    );
    if (!(await provider.connection.getAccountInfo(stakeVaultPda))) {
      await program.methods
        .initializeStakeVault()
        .accounts({ payer: provider.wallet.publicKey, ansemwMint: cfg.ansemwMint })
        .rpc();
      console.log("  stake vault created");
    }

    // Transfer the collection's update authority to the config PDA so
    // mint_nft can sign CreateV1 CPIs without an external keypair.
    // Safe to call multiple times - the guard in the program rejects
    // a second call if collection_claimed is already true.
    if (!existing || !cfg.collectionClaimed) {
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")], program.programId
      );
      await program.methods
        .claimCollectionAuthority()
        .accounts({
          authority: provider.wallet.publicKey,
          collection: liveCollection,
        })
        .rpc();
      console.log("  collection authority transferred to program PDA - minting unlocked");
    } else {
      console.log("  collection authority already claimed");
    }

    // Demo only: activate one piece and fund a reward round.
    if (SEED_DEMO && assets.length > 0 && target.equals(provider.wallet.publicKey)) {
      await program.methods
        .activate()
        .accounts({
          owner: target,
          asset: assets[0],
          ansemwMint: cfg.ansemwMint,
          ownerAnsemw: targetAnsemw,
        })
        .rpc();

      const funder = await createAssociatedTokenAccount(
        provider.connection, payer, cfg.ansemMint, provider.wallet.publicKey
      ).catch(() =>
        getAssociatedTokenAddressSync(cfg.ansemMint, provider.wallet.publicKey)
      );
      await mintTo(
        provider.connection, payer, cfg.ansemMint, funder,
        provider.wallet.publicKey, 1_000_000_000
      );
      await program.methods
        .fundRewards(new anchor.BN(50_000_000))
        .accounts({ funder: provider.wallet.publicKey, funderAnsem: funder })
        .rpc();
      console.log("  activated one piece and funded a reward round");
    } else if (SEED_DEMO && assets.length > 0) {
      console.log(
        "  pieces are asleep - activate them from the site with your wallet"
      );
    }

    // Mint stays closed until the authority runs npm run mint:live.
    const cfgFinal = await program.account.globalConfig.fetch(configPda);
    if (!cfgFinal.paused) {
      await program.methods
        .setPaused(true)
        .accounts({ authority: provider.wallet.publicKey })
        .rpc();
      console.log("  minting paused — run npm run mint:live when ready");
    } else {
      console.log("  minting already paused");
    }

    console.log("\n  collection:", liveCollection.toBase58());
    console.log("  $ANSEM  mint:", (cfg.ansemMint as PublicKey).toBase58());
    console.log("  $ANSEMW mint:", (cfg.ansemwMint as PublicKey).toBase58());
    console.log("  pieces:");
    assets.forEach((a) => console.log("   ", a.toBase58()));
    console.log("");
  });
});
