import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { assert } from "chai";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";
import {
  makeUmi,
  waitForChain,
  toWeb3,
  umiSignerFor,
  createCollection,
  mintAsset,
  transferAsset,
  burnAsset,
  readAssetMetadata,
} from "./core-helpers";

// Production is MIXED, and this suite mirrors it exactly: the real
// $ANSEM ("The Black Bull") is a Token-2022 mint, while the ansem.io
// launchpad that mints $ANSEMW issues classic SPL Token. The program
// accepts either (Interface<TokenInterface>), but every instruction
// must be handed the program that owns the mint it touches - and a
// mismatch there can only surface when the two actually differ, which
// is precisely this configuration.
/// Trailing slash on purpose: the program concatenates, so piece N is
/// `${TEST_BASE_URI}${N}.json`.
const TEST_BASE_URI = "https://example.com/meta/";

const ANSEM_TOKEN = TOKEN_2022_PROGRAM_ID;
const ANSEMW_TOKEN = TOKEN_PROGRAM_ID;

describe("ansem-world-v4", () => {
  // Same reasoning as in core-helpers: a local validator has no
  // forks, so waiting past "processed" is pure latency.
  const envProvider = anchor.AnchorProvider.env();
  anchor.setProvider(
    new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
      commitment: "processed",
      preflightCommitment: "processed",
    })
  );
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.ansemWorldV4 as Program<AnsemWorldV4>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const ACTIVATION_COST = 25_000;
  /// Atomic units per whole $ANSEMW (the mint is created with 6 decimals
  /// below). Costs in the config are whole-token counts; SPL balances
  /// are atomic, so anything crossing that line gets scaled by this.
  const ANSEMW_UNIT = 1_000_000;

  // The Stackers table. Thresholds are cumulative $ANSEMW; weights
  // are the 1x/1.4x/1.9x/2.5x/3.5x multipliers expressed against a
  // base of 100 so every tier lands on a whole number.
  const TIER_THRESHOLDS = [25_000, 75_000, 150_000, 300_000, 850_000];
  const TIER_WEIGHTS = [100, 140, 190, 250, 350];
  // 50,000 for the second part, 100,000 more for the third.
  const FUSE_COSTS = [50_000, 100_000];
  const bnArray = (xs: number[]) => xs.map((x) => new anchor.BN(x));

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [rewardStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_state")],
    program.programId
  );
  const [rewardVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reward_vault")],
    program.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId
  );
  const positionPdaFor = (asset: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), asset.toBuffer()],
      program.programId
    )[0];

  let umi: ReturnType<typeof makeUmi>;
  let collection: Awaited<ReturnType<typeof createCollection>>;
  let ansemMint: PublicKey;
  let ansemwMint: PublicKey;
  let funderAnsem: PublicKey;
  const treasuryDestination = Keypair.generate().publicKey;

  /// A funded wallet holding a real Core NFT plus enough $ANSEMW
  /// for one activation.
  ///
  /// `ansemwAmount` is a WHOLE $ANSEMW count, matching how every cost
  /// constant in this file (ACTIVATION_COST, TIER_THRESHOLDS,
  /// FUSE_COSTS) and the on-chain config are written. It's scaled to
  /// atomic units for the mint, the same way the program scales costs
  /// before each burn CPI.
  const airdrop = async (to: PublicKey, sol: number) => {
    const sig = await provider.connection.requestAirdrop(
      to,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");
  };

  const fetchCoreAsset = (asset: PublicKey) => readAssetMetadata(umi, asset);

  /// The suite asserts failures by catching, so that the *reason* is
  /// checked rather than just "something threw" - a test that passes on
  /// the wrong error is worse than no test.
  const mustFail = async (call: Promise<unknown>, contains: string) => {
    try {
      await call;
      assert.fail(`expected this to fail with ${contains}`);
    } catch (err: any) {
      assert.include(
        err.toString(),
        contains,
        `failed, but not with ${contains}. Actual: ${err.toString()}`
      );
    }
  };

  const makeHolder = async (ansemwAmount = ACTIVATION_COST) => {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey,
      3 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");

    const asset = await mintAsset(umi, collection, kp.publicKey);
    const assetKey = toWeb3(asset.publicKey);

    const ansemw = await createAssociatedTokenAccount(provider.connection, payer, ansemwMint, kp.publicKey, undefined, ANSEMW_TOKEN);
    await mintTo(provider.connection, payer, ansemwMint, ansemw, provider.wallet.publicKey, ansemwAmount * ANSEMW_UNIT, undefined, undefined, ANSEMW_TOKEN);

    return { kp, asset, assetKey, ansemw };
  };

  const initPosition = (asset: PublicKey) =>
    program.methods
      .initializePosition()
      .accounts({ payer: provider.wallet.publicKey, asset })
      .rpc();

  const activate = (asset: PublicKey, holder: Keypair, ansemw: PublicKey) =>
    program.methods
      .activate()
      .accounts({
        owner: holder.publicKey,
        asset,
        ansemwMint,
        ownerAnsemw: ansemw,
        tokenProgram: ANSEMW_TOKEN,
      })
      .signers([holder])
      .rpc();

  const fund = (amount: number) =>
    program.methods
      .fundRewards(new anchor.BN(amount))
      .accounts({
        funder: provider.wallet.publicKey,
        funderAnsem,
        tokenProgram: ANSEM_TOKEN,
      })
      .rpc();

  const settle = (positionPda: PublicKey) =>
    program.methods
      .settlePosition()
      .accounts({ position: positionPda })
      .rpc();

  before(async () => {
    // Always follow the provider's endpoint rather than assuming
    // 8899 - anchor test picks the port, and a hardcoded URL can
    // silently point at a different (or dead) validator.
    umi = makeUmi(provider.connection.rpcEndpoint, payer);
    await waitForChain(umi);
    collection = await createCollection(umi);

    ansemMint = await createMint(
      provider.connection,
      payer,
      provider.wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      ANSEM_TOKEN
    );
    ansemwMint = await createMint(
      provider.connection,
      payer,
      provider.wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      ANSEMW_TOKEN
    );

    await program.methods
      .initializeProtocol({
        coreCollection: toWeb3(collection.publicKey),
        treasury: treasuryDestination,
        activationCost: new anchor.BN(ACTIVATION_COST),
        tierThresholds: bnArray(TIER_THRESHOLDS),
        tierWeights: bnArray(TIER_WEIGHTS),
        fuseCosts: bnArray(FUSE_COSTS),
        mintPrice: new anchor.BN(100_000_000), // 0.1 SOL
        maxSupply: 10_000,
        baseUri: TEST_BASE_URI,
      })
      .accounts({
        authority: provider.wallet.publicKey,
        ansemMint,
        ansemwMint,
        // The reward vault created here holds $ANSEM, so this must be
        // $ANSEM's program even though $ANSEMW is also passed (that one
        // is only read, and InterfaceAccount accepts either program).
        tokenProgram: ANSEM_TOKEN,
      })
      .rpc();

    // fuse() writes into this account, so it has to exist before any
    // test that fuses.
    await program.methods
      .initializeFuseFeed()
      .accounts({ payer: provider.wallet.publicKey })
      .rpc();

    // Same for the vault that holds locked $ANSEMW - stake() transfers
    // into it, so it cannot be created lazily on first use.
    await program.methods
      .initializeStakeVault()
      .accounts({ payer: provider.wallet.publicKey, ansemwMint })
      .accountsPartial({ tokenProgram: ANSEMW_TOKEN })
      .rpc();

    funderAnsem = await createAssociatedTokenAccount(provider.connection, payer, ansemMint, provider.wallet.publicKey, undefined, ANSEM_TOKEN);
    await mintTo(provider.connection, payer, ansemMint, funderAnsem, provider.wallet.publicKey, 1_000_000_000, undefined, undefined, ANSEM_TOKEN);
  });

  it("records protocol config against the real collection", async () => {
    const config = await program.account.globalConfig.fetch(configPda);
    assert.strictEqual(
      config.coreCollection.toBase58(),
      toWeb3(collection.publicKey).toBase58()
    );
    assert.strictEqual(config.activationCost.toNumber(), ACTIVATION_COST);
  });

  it("creates an asleep position for a real Core asset", async () => {
    const { assetKey } = await makeHolder();
    await initPosition(assetKey);

    const p = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(p.asset.toBase58(), assetKey.toBase58());
    assert.strictEqual(p.active, false);
    assert.strictEqual(p.vaultBalance.toNumber(), 0);
  });

  it("rejects an asset that is not a Core account at all", async () => {
    const impostor = Keypair.generate().publicKey;
    try {
      await initPosition(impostor);
      assert.fail("a non-Core address must not get a position");
    } catch (err: any) {
      assert.include(err.toString(), "NotACoreAsset");
    }
  });

  it("rejects a real Core asset from a different collection", async () => {
    const otherCollection = await createCollection(umi);
    const stranger = await mintAsset(
      umi,
      otherCollection,
      provider.wallet.publicKey
    );

    try {
      await initPosition(toWeb3(stranger.publicKey));
      assert.fail("an asset outside the collection must be rejected");
    } catch (err: any) {
      assert.include(err.toString(), "InvalidCollection");
    }
  });

  it("activates only for the true on-chain holder", async () => {
    const { kp, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);

    const p = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(p.active, true);
    assert.strictEqual(p.activationOwner.toBase58(), kp.publicKey.toBase58());

    const acct = await getAccount(provider.connection, ansemw, undefined, ANSEMW_TOKEN);
    assert.strictEqual(Number(acct.amount), 0, "$ANSEMW was burned");
  });

  it("refuses activation by someone who does not hold the NFT", async () => {
    const { assetKey } = await makeHolder();
    await initPosition(assetKey);

    // A different wallet, with its own $ANSEMW, tries to activate
    // an NFT it does not own.
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");
    const attackerAnsemw = await createAssociatedTokenAccount(provider.connection, payer, ansemwMint, attacker.publicKey, undefined, ANSEMW_TOKEN);
    await mintTo(provider.connection, payer, ansemwMint, attackerAnsemw, provider.wallet.publicKey, ACTIVATION_COST, undefined, undefined, ANSEMW_TOKEN);

    try {
      await activate(assetKey, attacker, attackerAnsemw);
      assert.fail("activating someone else's NFT must be rejected");
    } catch (err: any) {
      assert.include(err.toString(), "NotAssetOwner");
    }
  });

  it("credits rewards into the NFT's vault", async () => {
    const { kp, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    const positionPda = positionPdaFor(assetKey);

    const p = await program.account.position.fetch(positionPda);
    const totalWeight = (
      await program.account.rewardState.fetch(rewardStatePda)
    ).totalWeight.toNumber();

    const FUND = 5_000_000;
    await fund(FUND);

    const vault = await getAccount(provider.connection, rewardVaultPda, undefined, ANSEM_TOKEN);
    assert.strictEqual(Number(vault.amount), FUND);

    await settle(positionPda);

    const expected = Math.floor(
      (FUND * p.effectiveWeight.toNumber()) / totalWeight
    );
    const after = await program.account.position.fetch(positionPda);
    assert.strictEqual(after.vaultBalance.toNumber(), expected);
  });

  it("does not credit twice for the same funding", async () => {
    const { kp, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    const positionPda = positionPdaFor(assetKey);

    await fund(3_000_000);
    await settle(positionPda);
    const first = (
      await program.account.position.fetch(positionPda)
    ).vaultBalance.toNumber();

    await settle(positionPda);
    const second = (
      await program.account.position.fetch(positionPda)
    ).vaultBalance.toNumber();

    assert.strictEqual(second, first);
    assert.isAbove(first, 0);
  });

  it("lets the holder claim, and blocks a stranger from claiming", async () => {
    const { kp, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);

    await fund(4_000_000);

    const holderAnsem = await createAssociatedTokenAccount(provider.connection, payer, ansemMint, kp.publicKey, undefined, ANSEM_TOKEN);

    // A stranger cannot drain the NFT's vault.
    const thief = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      thief.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");
    const thiefAnsem = await createAssociatedTokenAccount(provider.connection, payer, ansemMint, thief.publicKey, undefined, ANSEM_TOKEN);

    try {
      await program.methods
        .claim()
        .accounts({
          owner: thief.publicKey,
          asset: assetKey,
          ownerAnsem: thiefAnsem,
          tokenProgram: ANSEM_TOKEN,
        })
        .signers([thief])
        .rpc();
      assert.fail("a non-holder must not be able to claim");
    } catch (err: any) {
      assert.include(err.toString(), "NotAssetOwner");
    }

    // The real holder can.
    await program.methods
      .claim()
      .accounts({
        owner: kp.publicKey,
        asset: assetKey,
        ownerAnsem: holderAnsem,
        tokenProgram: ANSEM_TOKEN,
      })
      .signers([kp])
      .rpc();

    const acct = await getAccount(provider.connection, holderAnsem, undefined, ANSEM_TOKEN);
    assert.isAbove(Number(acct.amount), 0);

    const after = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(after.vaultBalance.toNumber(), 0);
  });

  it("puts the position to sleep after a real transfer, keeping the vault with the NFT", async () => {
    const { kp, asset, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    const positionPda = positionPdaFor(assetKey);

    await fund(8_000_000);
    await settle(positionPda);
    const banked = (
      await program.account.position.fetch(positionPda)
    ).vaultBalance.toNumber();
    assert.isAbove(banked, 0);

    // sync_owner must refuse while the activator still holds it.
    try {
      await program.methods
        .syncOwner()
        .accounts({ asset: assetKey })
        .rpc();
      assert.fail("sync_owner must not fire on an untouched position");
    } catch (err: any) {
      assert.include(err.toString(), "ActivationOwnerMismatch");
    }

    const weightBefore = (
      await program.account.rewardState.fetch(rewardStatePda)
    ).totalWeight.toNumber();

    // A genuine secondary sale.
    const buyer = Keypair.generate();
    await transferAsset(
      umi,
      asset,
      collection,
      umiSignerFor(umi, kp),
      buyer.publicKey
    );

    await program.methods.syncOwner().accounts({ asset: assetKey }).rpc();

    const after = await program.account.position.fetch(positionPda);
    assert.strictEqual(after.active, false, "position went back to sleep");
    assert.strictEqual(
      after.activationOwner.toBase58(),
      PublicKey.default.toBase58()
    );
    assert.strictEqual(
      after.vaultBalance.toNumber(),
      banked,
      "the vault travels with the NFT"
    );
    assert.strictEqual(
      after.cumulativeAnsemwBurned.toNumber(),
      ACTIVATION_COST,
      "burn history stays with the NFT"
    );

    const rs = await program.account.rewardState.fetch(rewardStatePda);
    assert.strictEqual(
      rs.totalWeight.toNumber(),
      weightBefore - after.effectiveWeight.toNumber(),
      "weight left the pool"
    );
  });

  it("lets the new owner claim the inherited vault", async () => {
    const { kp, asset, assetKey, ansemw } = await makeHolder();
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    const positionPda = positionPdaFor(assetKey);

    await fund(6_000_000);
    await settle(positionPda);
    const inherited = (
      await program.account.position.fetch(positionPda)
    ).vaultBalance.toNumber();

    const buyer = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      buyer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");

    await transferAsset(
      umi,
      asset,
      collection,
      umiSignerFor(umi, kp),
      buyer.publicKey
    );
    await program.methods.syncOwner().accounts({ asset: assetKey }).rpc();

    const buyerAnsem = await createAssociatedTokenAccount(provider.connection, payer, ansemMint, buyer.publicKey, undefined, ANSEM_TOKEN);

    await program.methods
      .claim()
      .accounts({
        owner: buyer.publicKey,
        asset: assetKey,
        ownerAnsem: buyerAnsem,
        tokenProgram: ANSEM_TOKEN,
      })
      .signers([buyer])
      .rpc();

    const acct = await getAccount(provider.connection, buyerAnsem, undefined, ANSEM_TOKEN);
    assert.strictEqual(
      Number(acct.amount),
      inherited,
      "buyer receives exactly what the NFT was holding"
    );

    // And the seller cannot claim it any more.
    const sellerAnsem = await createAssociatedTokenAccount(provider.connection, payer, ansemMint, kp.publicKey, undefined, ANSEM_TOKEN);
    try {
      await program.methods
        .claim()
        .accounts({
          owner: kp.publicKey,
          asset: assetKey,
          ownerAnsem: sellerAnsem,
          tokenProgram: ANSEM_TOKEN,
        })
        .signers([kp])
        .rpc();
      assert.fail("the previous owner must not be able to claim");
    } catch (err: any) {
      assert.include(err.toString(), "NotAssetOwner");
    }
  });

  const upgrade = (
    asset: PublicKey,
    holder: Keypair,
    ansemw: PublicKey,
    targetTier: number
  ) =>
    program.methods
      .upgradeTier(targetTier)
      .accounts({
        owner: holder.publicKey,
        asset,
        ansemwMint,
        ownerAnsemw: ansemw,
        tokenProgram: ANSEMW_TOKEN,
      })
      .signers([holder])
      .rpc();

  it("charges the difference to upgrade a tier", async () => {
    const { kp, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);

    const before = Number((await getAccount(provider.connection, ansemw, undefined, ANSEMW_TOKEN)).amount);
    await upgrade(assetKey, kp, ansemw, 3);
    const after = Number((await getAccount(provider.connection, ansemw, undefined, ANSEMW_TOKEN)).amount);

    // tier 1 -> 3 costs 150,000 - 25,000 (whole $ANSEMW; the balance
    // delta is atomic, so scale the expected cost to match)
    assert.strictEqual(
      before - after,
      (TIER_THRESHOLDS[2] - TIER_THRESHOLDS[0]) * ANSEMW_UNIT
    );

    const p = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(p.tier, 3);
    assert.strictEqual(p.effectiveWeight.toNumber(), TIER_WEIGHTS[2]);
  });

  it("costs the same climbing step by step as jumping to the top", async () => {
    // The Stackers guarantee: paying in stages never costs more.
    const stepper = await makeHolder(2_000_000);
    await initPosition(stepper.assetKey);
    await activate(stepper.assetKey, stepper.kp, stepper.ansemw);
    const stepStart = Number(
      (await getAccount(provider.connection, stepper.ansemw, undefined, ANSEMW_TOKEN)).amount
    );
    for (const tier of [2, 3, 4, 5]) {
      await upgrade(stepper.assetKey, stepper.kp, stepper.ansemw, tier);
    }
    const stepSpent =
      stepStart -
      Number((await getAccount(provider.connection, stepper.ansemw, undefined, ANSEMW_TOKEN)).amount);

    const jumper = await makeHolder(2_000_000);
    await initPosition(jumper.assetKey);
    await activate(jumper.assetKey, jumper.kp, jumper.ansemw);
    const jumpStart = Number(
      (await getAccount(provider.connection, jumper.ansemw, undefined, ANSEMW_TOKEN)).amount
    );
    await upgrade(jumper.assetKey, jumper.kp, jumper.ansemw, 5);
    const jumpSpent =
      jumpStart -
      Number((await getAccount(provider.connection, jumper.ansemw, undefined, ANSEMW_TOKEN)).amount);

    assert.strictEqual(stepSpent, jumpSpent);
    assert.strictEqual(
      stepSpent,
      (TIER_THRESHOLDS[4] - TIER_THRESHOLDS[0]) * ANSEMW_UNIT
    );
  });

  it("does not pay the upgrade retroactively", async () => {
    // Rewards earned before the upgrade must be credited at the old
    // weight, not the new one.
    const { kp, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    const positionPda = positionPdaFor(assetKey);

    await fund(10_000_000);

    const weightAtFunding = (
      await program.account.rewardState.fetch(rewardStatePda)
    ).totalWeight.toNumber();
    const earnedAtTier1 = Math.floor(
      (10_000_000 * TIER_WEIGHTS[0]) / weightAtFunding
    );

    // Upgrading settles first, so the pending amount is locked in.
    await upgrade(assetKey, kp, ansemw, 5);

    const p = await program.account.position.fetch(positionPda);
    assert.strictEqual(
      p.vaultBalance.toNumber(),
      earnedAtTier1,
      "pre-upgrade rewards must be credited at the old tier"
    );
  });

  it("moves the position's weight in the global pool on upgrade", async () => {
    const { kp, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);

    const before = (
      await program.account.rewardState.fetch(rewardStatePda)
    ).totalWeight.toNumber();

    await upgrade(assetKey, kp, ansemw, 4);

    const after = (
      await program.account.rewardState.fetch(rewardStatePda)
    ).totalWeight.toNumber();
    assert.strictEqual(after - before, TIER_WEIGHTS[3] - TIER_WEIGHTS[0]);
  });

  it("keeps the tier through a sale, and reactivation does not reset it", async () => {
    const { kp, asset, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    await upgrade(assetKey, kp, ansemw, 4);

    const buyer = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      buyer.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "processed");

    await transferAsset(umi, asset, collection, umiSignerFor(umi, kp), buyer.publicKey);
    await program.methods.syncOwner().accounts({ asset: assetKey }).rpc();

    const asleep = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(asleep.active, false);
    assert.strictEqual(asleep.tier, 4, "tier survives the sale");

    // The buyer pays only the wake-up fee, not the tier again.
    const buyerAnsemw = await createAssociatedTokenAccount(provider.connection, payer, ansemwMint, buyer.publicKey, undefined, ANSEMW_TOKEN);
    await mintTo(provider.connection, payer, ansemwMint, buyerAnsemw, provider.wallet.publicKey, ACTIVATION_COST * ANSEMW_UNIT, undefined, undefined, ANSEMW_TOKEN);
    await activate(assetKey, buyer, buyerAnsemw);

    const awake = await program.account.position.fetch(positionPdaFor(assetKey));
    assert.strictEqual(awake.active, true);
    assert.strictEqual(awake.tier, 4);
    assert.strictEqual(awake.effectiveWeight.toNumber(), TIER_WEIGHTS[3]);
    assert.strictEqual(
      Number((await getAccount(provider.connection, buyerAnsemw, undefined, ANSEMW_TOKEN)).amount),
      0,
      "buyer paid exactly the activation cost"
    );
  });

  it("rejects a downgrade and a non-existent tier", async () => {
    const { kp, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);
    await upgrade(assetKey, kp, ansemw, 3);

    try {
      await upgrade(assetKey, kp, ansemw, 2);
      assert.fail("downgrade must be rejected");
    } catch (err: any) {
      assert.include(err.toString(), "NotAnUpgrade");
    }

    try {
      await upgrade(assetKey, kp, ansemw, 9);
      assert.fail("tier 9 does not exist");
    } catch (err: any) {
      assert.include(err.toString(), "InvalidTier");
    }
  });

  it("refuses an upgrade from someone who does not hold the NFT", async () => {
    const { kp, assetKey, ansemw } = await makeHolder(1_000_000);
    await initPosition(assetKey);
    await activate(assetKey, kp, ansemw);

    const attacker = await makeHolder(1_000_000);
    try {
      await program.methods
        .upgradeTier(3)
        .accounts({
          owner: attacker.kp.publicKey,
          asset: assetKey,
          ansemwMint,
          ownerAnsemw: attacker.ansemw,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([attacker.kp])
        .rpc();
      assert.fail("upgrading someone else's NFT must be rejected");
    } catch (err: any) {
      assert.include(err.toString(), "NotAssetOwner");
    }
  });

  describe("admin controls", () => {
    const setPaused = (paused: boolean, signer = payer) =>
      program.methods
        .setPaused(paused)
        .accounts({ authority: signer.publicKey })
        .signers(signer === payer ? [] : [signer])
        .rpc();

    afterEach(async () => {
      // Never leave the protocol paused for the next test.
      const c = await program.account.globalConfig.fetch(configPda);
      if (c.paused) await setPaused(false);
    });

    it("only lets the authority pause", async () => {
      const stranger = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        stranger.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "processed");

      try {
        await setPaused(true, stranger);
        assert.fail("a stranger must not be able to pause");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
      }

      await setPaused(true);
      assert.isTrue((await program.account.globalConfig.fetch(configPda)).paused);
    });

    it("blocks activation while paused", async () => {
      const { kp, assetKey, ansemw } = await makeHolder();
      await initPosition(assetKey);
      await setPaused(true);

      try {
        await activate(assetKey, kp, ansemw);
        assert.fail("activation must be blocked while paused");
      } catch (err: any) {
        assert.include(err.toString(), "ProtocolPaused");
      }
    });

    it("keeps settle_position working while paused", async () => {
      // Accounting must never freeze in a state that favours anyone.
      const { kp, assetKey, ansemw } = await makeHolder();
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);
      await fund(5_000_000);

      await setPaused(true);
      await settle(positionPdaFor(assetKey));

      const p = await program.account.position.fetch(positionPdaFor(assetKey));
      assert.isAbove(p.vaultBalance.toNumber(), 0);
    });

    it("hands over authority and locks out the old key", async () => {
      const next = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        next.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "processed");

      await program.methods
        .transferAuthority(next.publicKey)
        .accounts({ authority: payer.publicKey })
        .rpc();

      assert.strictEqual(
        (await program.account.globalConfig.fetch(configPda)).authority.toBase58(),
        next.publicKey.toBase58()
      );

      // Old key is now powerless.
      try {
        await setPaused(true);
        assert.fail("the previous authority must lose control");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
      }

      // Hand it back so later tests keep working.
      await program.methods
        .transferAuthority(payer.publicKey)
        .accounts({ authority: next.publicKey })
        .signers([next])
        .rpc();
    });
  });

  describe("fee pipeline", () => {
    it("collects revenue and only releases it to the fixed address", async () => {
      // Royalties and trading fees arrive as a plain SOL transfer;
      // the sender needs to know nothing about this program.
      const REVENUE = 2 * anchor.web3.LAMPORTS_PER_SOL;
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: treasuryPda,
          lamports: REVENUE,
        })
      );
      await provider.sendAndConfirm(tx, []);

      const held = await provider.connection.getBalance(treasuryPda);
      assert.isAtLeast(held, REVENUE);

      // A stranger cannot drain it.
      const thief = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        thief.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "processed");
      try {
        await program.methods
          .withdrawTreasury(new anchor.BN(REVENUE))
          .accounts({
            authority: thief.publicKey,
            destination: treasuryDestination,
          })
          .signers([thief])
          .rpc();
        assert.fail("only the authority may withdraw");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
      }

      // Not even the authority can redirect it elsewhere.
      try {
        await program.methods
          .withdrawTreasury(new anchor.BN(REVENUE))
          .accounts({
            authority: payer.publicKey,
            destination: Keypair.generate().publicKey,
          })
          .rpc();
        assert.fail("the destination is fixed at initialization");
      } catch (err: any) {
        assert.include(err.toString(), "Unauthorized");
      }

      // The authority releases it to the declared address.
      const before = await provider.connection.getBalance(treasuryDestination);
      await program.methods
        .withdrawTreasury(new anchor.BN(REVENUE))
        .accounts({
          authority: payer.publicKey,
          destination: treasuryDestination,
        })
        .rpc();
      const after = await provider.connection.getBalance(treasuryDestination);

      assert.strictEqual(after - before, REVENUE);
      const t = await program.account.treasury.fetch(treasuryPda);
      assert.strictEqual(t.totalWithdrawn.toNumber(), REVENUE);
    });

    it("never lets the treasury account fall below rent", async () => {
      // Draining past the rent floor would let the runtime purge
      // the protocol's own revenue address.
      const balance = await provider.connection.getBalance(treasuryPda);
      try {
        await program.methods
          .withdrawTreasury(new anchor.BN(balance))
          .accounts({
            authority: payer.publicKey,
            destination: treasuryDestination,
          })
          .rpc();
        assert.fail("withdrawing the full balance must be rejected");
      } catch (err: any) {
        assert.include(err.toString(), "InsufficientRewardLiquidity");
      }
    });
  });

  describe("fuse", () => {
    const fuse = (
      survivor: PublicKey,
      absorbed: PublicKey,
      holder: Keypair,
      ansemw: PublicKey
    ) =>
      program.methods
        .fuse()
        .accounts({
          owner: holder.publicKey,
          survivorAsset: survivor,
          absorbedAsset: absorbed,
          collection: toWeb3(collection.publicKey),
          ansemwMint,
          ownerAnsemw: ansemw,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([holder])
        .rpc();

    /// One wallet holding two NFTs, with plenty of $ANSEMW.
    const holderWithTwo = async () => {
      const a = await makeHolder(5_000_000);
      const second = await mintAsset(umi, collection, a.kp.publicKey);
      const secondKey = toWeb3(second.publicKey);
      await initPosition(a.assetKey);
      await initPosition(secondKey);
      return { ...a, secondKey };
    };

    it("adds the weights and applies the 20% bonus", async () => {
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);
      await activate(secondKey, kp, ansemw);

      const before = Number((await getAccount(provider.connection, ansemw, undefined, ANSEMW_TOKEN)).amount);
      await fuse(assetKey, secondKey, kp, ansemw);
      const after = Number((await getAccount(provider.connection, ansemw, undefined, ANSEMW_TOKEN)).amount);

      assert.strictEqual(before - after, FUSE_COSTS[0] * ANSEMW_UNIT);

      const p = await program.account.position.fetch(positionPdaFor(assetKey));
      assert.strictEqual(p.absorbedCount, 1);
      assert.strictEqual(p.baseWeight.toNumber(), TIER_WEIGHTS[0] * 2);
      // (100 + 100) * 1.20
      assert.strictEqual(p.effectiveWeight.toNumber(), 240);
    });

    it("reaches 13.65x when three top-tier NFTs merge", async () => {
      // The headline Stackers number: 3 x 3.5 x 1.30.
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      const third = await mintAsset(umi, collection, kp.publicKey);
      const thirdKey = toWeb3(third.publicKey);
      await initPosition(thirdKey);

      for (const a of [assetKey, secondKey, thirdKey]) {
        await activate(a, kp, ansemw);
        await upgrade(a, kp, ansemw, 5);
      }

      await fuse(assetKey, secondKey, kp, ansemw);
      await fuse(assetKey, thirdKey, kp, ansemw);

      const p = await program.account.position.fetch(positionPdaFor(assetKey));
      assert.strictEqual(p.absorbedCount, 2);
      assert.strictEqual(p.baseWeight.toNumber(), 350 * 3);
      // 1050 * 1.30 = 1365, i.e. 13.65x against a base of 100.
      assert.strictEqual(p.effectiveWeight.toNumber(), 1365);
    });

    it("carries the absorbed vault across instead of stranding it", async () => {
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);
      await activate(secondKey, kp, ansemw);

      await fund(9_000_000);
      await settle(positionPdaFor(assetKey));
      await settle(positionPdaFor(secondKey));

      const survivorBefore = (
        await program.account.position.fetch(positionPdaFor(assetKey))
      ).vaultBalance.toNumber();
      const absorbedBefore = (
        await program.account.position.fetch(positionPdaFor(secondKey))
      ).vaultBalance.toNumber();
      assert.isAbove(absorbedBefore, 0);

      await fuse(assetKey, secondKey, kp, ansemw);

      const after = await program.account.position.fetch(positionPdaFor(assetKey));
      assert.strictEqual(
        after.vaultBalance.toNumber(),
        survivorBefore + absorbedBefore
      );
    });

    it("destroys the absorbed NFT and closes its position", async () => {
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);
      await fuse(assetKey, secondKey, kp, ansemw);

      // Core does not delete the account; it strips it back to a
      // single byte holding Key::Uninitialized (0). That marker is
      // what proves the asset is gone rather than merely emptied.
      const burned = await provider.connection.getAccountInfo(secondKey);
      assert.strictEqual(burned?.data.length, 1, "asset stripped to a marker");
      assert.strictEqual(burned?.data[0], 0, "marked Uninitialized");

      const closed = await provider.connection.getAccountInfo(
        positionPdaFor(secondKey)
      );
      assert.isNull(closed, "the position account must be closed");
    });

    it("moves the merged weight into the global pool correctly", async () => {
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);
      await activate(secondKey, kp, ansemw);

      const before = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      await fuse(assetKey, secondKey, kp, ansemw);

      const after = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      // Two 100s leave, one 240 arrives: the fused NFT earns more
      // than its parents did combined, diluting everyone slightly.
      assert.strictEqual(after - before, 240 - 200);
    });

    it("upgrading a fused NFT keeps the absorbed weight", async () => {
      // Regression guard: raising the survivor's own tier must add
      // the delta, not overwrite the combined base.
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);
      await activate(secondKey, kp, ansemw);
      await fuse(assetKey, secondKey, kp, ansemw);

      await upgrade(assetKey, kp, ansemw, 3);

      const p = await program.account.position.fetch(positionPdaFor(assetKey));
      // base was 200; own rung goes 100 -> 190, so +90.
      assert.strictEqual(p.baseWeight.toNumber(), 290);
      assert.strictEqual(p.effectiveWeight.toNumber(), Math.floor(290 * 1.2));
    });

    it("refuses a fourth part, self-fusing, and someone else's NFT", async () => {
      const { kp, assetKey, secondKey, ansemw } = await holderWithTwo();
      await activate(assetKey, kp, ansemw);

      try {
        await fuse(assetKey, assetKey, kp, ansemw);
        assert.fail("an NFT cannot absorb itself");
      } catch (err: any) {
        assert.include(err.toString(), "CannotFuseWithSelf");
      }

      const stranger = await makeHolder(5_000_000);
      // Give it a position, so the rejection is about ownership
      // rather than simply a missing account.
      await initPosition(stranger.assetKey);
      try {
        await fuse(assetKey, stranger.assetKey, kp, ansemw);
        assert.fail("cannot absorb an NFT you do not hold");
      } catch (err: any) {
        assert.include(err.toString(), "NotAssetOwner");
      }

      // Fill both slots, then try a fourth part.
      const third = await mintAsset(umi, collection, kp.publicKey);
      const fourth = await mintAsset(umi, collection, kp.publicKey);
      const thirdKey = toWeb3(third.publicKey);
      const fourthKey = toWeb3(fourth.publicKey);
      await initPosition(thirdKey);
      await initPosition(fourthKey);

      await fuse(assetKey, secondKey, kp, ansemw);
      await fuse(assetKey, thirdKey, kp, ansemw);
      try {
        await fuse(assetKey, fourthKey, kp, ansemw);
        assert.fail("three parts is the ceiling");
      } catch (err: any) {
        assert.include(err.toString(), "FuseLimitReached");
      }
    });
  });

  describe("reforge", () => {
    const reforge = (
      asset: PublicKey,
      holder: Keypair,
      ansemw: PublicKey,
      partIndex: number,
      targetTier: number
    ) =>
      program.methods
        .reforge(partIndex, targetTier)
        .accounts({
          owner: holder.publicKey,
          asset,
          ansemwMint,
          ownerAnsemw: ansemw,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([holder])
        .rpc();

    const fuse = (
      survivor: PublicKey,
      absorbed: PublicKey,
      holder: Keypair,
      ansemw: PublicKey
    ) =>
      program.methods
        .fuse()
        .accounts({
          owner: holder.publicKey,
          survivorAsset: survivor,
          absorbedAsset: absorbed,
          collection: toWeb3(collection.publicKey),
          ansemwMint,
          ownerAnsemw: ansemw,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([holder])
        .rpc();

    /// A fused NFT: survivor plus one absorbed part at tier 1.
    const fusedPair = async () => {
      const a = await makeHolder(5_000_000);
      const second = await mintAsset(umi, collection, a.kp.publicKey);
      const secondKey = toWeb3(second.publicKey);
      await initPosition(a.assetKey);
      await initPosition(secondKey);
      await activate(a.assetKey, a.kp, a.ansemw);
      await fuse(a.assetKey, secondKey, a.kp, a.ansemw);
      return a;
    };

    it("records the absorbed part's tier at the moment it is fused", async () => {
      const a = await makeHolder(5_000_000);
      const second = await mintAsset(umi, collection, a.kp.publicKey);
      const secondKey = toWeb3(second.publicKey);
      await initPosition(a.assetKey);
      await initPosition(secondKey);
      await activate(a.assetKey, a.kp, a.ansemw);
      await activate(secondKey, a.kp, a.ansemw);
      // Raise the part BEFORE fusing, so it enters at tier 3.
      await upgrade(secondKey, a.kp, a.ansemw, 3);
      await fuse(a.assetKey, secondKey, a.kp, a.ansemw);

      const p = await program.account.position.fetch(positionPdaFor(a.assetKey));
      assert.strictEqual(p.absorbedTiers[0], 3);
      // own tier 1 (100) + part tier 3 (190) = 290, x1.20
      assert.strictEqual(p.baseWeight.toNumber(), 290);
      assert.strictEqual(p.effectiveWeight.toNumber(), 348);
    });

    it("raises an absorbed part and reprices the weight", async () => {
      const a = await fusedPair();

      const before = Number((await getAccount(provider.connection, a.ansemw, undefined, ANSEMW_TOKEN)).amount);
      await reforge(a.assetKey, a.kp, a.ansemw, 0, 5);
      const after = Number((await getAccount(provider.connection, a.ansemw, undefined, ANSEMW_TOKEN)).amount);

      // Same table as upgrade_tier: 850,000 - 25,000 (whole $ANSEMW,
      // scaled to atomic to match the balance delta).
      assert.strictEqual(
        before - after,
        (TIER_THRESHOLDS[4] - TIER_THRESHOLDS[0]) * ANSEMW_UNIT
      );

      const p = await program.account.position.fetch(positionPdaFor(a.assetKey));
      assert.strictEqual(p.absorbedTiers[0], 5);
      // own tier 1 (100) + part tier 5 (350) = 450, x1.20 = 540
      assert.strictEqual(p.baseWeight.toNumber(), 450);
      assert.strictEqual(p.effectiveWeight.toNumber(), 540);
    });

    it("costs the same whether you raise a part before or after fusing", async () => {
      // The whole point: fusing early must not be a punishment.
      const before = await makeHolder(5_000_000);
      const b2 = await mintAsset(umi, collection, before.kp.publicKey);
      const b2Key = toWeb3(b2.publicKey);
      await initPosition(before.assetKey);
      await initPosition(b2Key);
      await activate(before.assetKey, before.kp, before.ansemw);
      await activate(b2Key, before.kp, before.ansemw);
      const beforeStart = Number(
        (await getAccount(provider.connection, before.ansemw, undefined, ANSEMW_TOKEN)).amount
      );
      await upgrade(b2Key, before.kp, before.ansemw, 5); // raise, then fuse
      await fuse(before.assetKey, b2Key, before.kp, before.ansemw);
      const beforeSpent =
        beforeStart -
        Number((await getAccount(provider.connection, before.ansemw, undefined, ANSEMW_TOKEN)).amount);

      const after = await makeHolder(5_000_000);
      const a2 = await mintAsset(umi, collection, after.kp.publicKey);
      const a2Key = toWeb3(a2.publicKey);
      await initPosition(after.assetKey);
      await initPosition(a2Key);
      await activate(after.assetKey, after.kp, after.ansemw);
      await activate(a2Key, after.kp, after.ansemw);
      const afterStart = Number(
        (await getAccount(provider.connection, after.ansemw, undefined, ANSEMW_TOKEN)).amount
      );
      await fuse(after.assetKey, a2Key, after.kp, after.ansemw); // fuse, then raise
      await reforge(after.assetKey, after.kp, after.ansemw, 0, 5);
      const afterSpent =
        afterStart -
        Number((await getAccount(provider.connection, after.ansemw, undefined, ANSEMW_TOKEN)).amount);

      assert.strictEqual(beforeSpent, afterSpent);

      // And both end up at the same weight.
      const pb = await program.account.position.fetch(positionPdaFor(before.assetKey));
      const pa = await program.account.position.fetch(positionPdaFor(after.assetKey));
      assert.strictEqual(
        pb.effectiveWeight.toNumber(),
        pa.effectiveWeight.toNumber()
      );
    });

    it("leaves the NFT's own tier alone", async () => {
      const a = await fusedPair();
      await reforge(a.assetKey, a.kp, a.ansemw, 0, 4);

      const p = await program.account.position.fetch(positionPdaFor(a.assetKey));
      assert.strictEqual(p.tier, 1, "own rung untouched");
      assert.strictEqual(p.absorbedTiers[0], 4);
    });

    it("rejects an empty slot, a downgrade, and a non-holder", async () => {
      const a = await fusedPair();

      try {
        await reforge(a.assetKey, a.kp, a.ansemw, 1, 3);
        assert.fail("slot 1 holds nothing yet");
      } catch (err: any) {
        assert.include(err.toString(), "NoSuchPart");
      }

      await reforge(a.assetKey, a.kp, a.ansemw, 0, 3);
      try {
        await reforge(a.assetKey, a.kp, a.ansemw, 0, 2);
        assert.fail("downgrade must be rejected");
      } catch (err: any) {
        assert.include(err.toString(), "NotAnUpgrade");
      }

      const stranger = await makeHolder(5_000_000);
      try {
        await reforge(a.assetKey, stranger.kp, stranger.ansemw, 0, 5);
        assert.fail("only the holder may reforge");
      } catch (err: any) {
        assert.include(err.toString(), "NotAssetOwner");
      }
    });
  });
  describe("stake", () => {
    // 100,000 $ANSEMW is the first Stackers rung: +5%.
    const STAKE_AMOUNT = 100_000;

    const stake = (
      asset: PublicKey,
      holder: Keypair,
      ansemw: PublicKey,
      whole: number
    ) =>
      program.methods
        .stake(new anchor.BN(whole * ANSEMW_UNIT))
        .accounts({
          staker: holder.publicKey,
          stakerAnsemw: ansemw,
          ansemwMint,
          asset,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([holder])
        .rpc();

    const unstake = (
      asset: PublicKey,
      holder: Keypair,
      ansemw: PublicKey
    ) =>
      program.methods
        .unstake()
        .accounts({
          staker: holder.publicKey,
          owner: holder.publicKey,
          stakerAnsemw: ansemw,
          ansemwMint,
          asset,
          tokenProgram: ANSEMW_TOKEN,
        })
        .signers([holder])
        .rpc();

    it("raises the piece's weight and the pool by the same delta", async () => {
      const { kp, assetKey, ansemw } = await makeHolder(
        ACTIVATION_COST + STAKE_AMOUNT
      );
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);
      const positionPda = positionPdaFor(assetKey);

      const before = await program.account.position.fetch(positionPda);
      const poolBefore = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      await stake(assetKey, kp, ansemw, STAKE_AMOUNT);

      const after = await program.account.position.fetch(positionPda);
      const poolAfter = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      assert.strictEqual(after.stakeBonusPct, 5, "first Stackers rung");
      assert.strictEqual(
        after.effectiveWeight.toNumber(),
        Math.floor((before.effectiveWeight.toNumber() * 105) / 100)
      );
      assert.strictEqual(
        poolAfter - poolBefore,
        after.effectiveWeight.toNumber() - before.effectiveWeight.toNumber(),
        "the pool moved by exactly what the piece moved"
      );
    });

    it("returns the tokens and clears the bonus on a plain unstake", async () => {
      const { kp, assetKey, ansemw } = await makeHolder(
        ACTIVATION_COST + STAKE_AMOUNT
      );
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);
      const positionPda = positionPdaFor(assetKey);

      await stake(assetKey, kp, ansemw, STAKE_AMOUNT);
      const boosted = await program.account.position.fetch(positionPda);
      assert.strictEqual(boosted.stakeBonusPct, 5);

      await unstake(assetKey, kp, ansemw);

      const cleared = await program.account.position.fetch(positionPda);
      assert.strictEqual(cleared.stakeBonusPct, 0, "bonus stripped");
      const back = await getAccount(
        provider.connection,
        ansemw,
        undefined,
        ANSEMW_TOKEN
      );
      assert.strictEqual(
        Number(back.amount),
        STAKE_AMOUNT * ANSEMW_UNIT,
        "every locked token came back"
      );
    });

    // The regression this guards: a seller's StakeAccount outlives the
    // sale, and unstake used to zero the piece's bonus unconditionally.
    // Once the buyer had activated and staked their own $ANSEMW, the
    // seller withdrawing their tokens wiped the buyer's bonus with them.
    it("does not let a previous owner strip the new owner's stake bonus", async () => {
      const seller = await makeHolder(ACTIVATION_COST + STAKE_AMOUNT);
      const { kp, asset, assetKey, ansemw } = seller;
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);
      const positionPda = positionPdaFor(assetKey);

      await stake(assetKey, kp, ansemw, STAKE_AMOUNT);
      assert.strictEqual(
        (await program.account.position.fetch(positionPda)).stakeBonusPct,
        5
      );

      // A real sale, then the permissionless sync that puts the piece
      // back to sleep and drops the seller's bonus.
      const buyer = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        buyer.publicKey,
        3 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "processed");
      await transferAsset(
        umi,
        asset,
        collection,
        umiSignerFor(umi, kp),
        buyer.publicKey
      );
      await program.methods.syncOwner().accounts({ asset: assetKey }).rpc();

      // The buyer activates and stakes their own tokens.
      const buyerAnsemw = await createAssociatedTokenAccount(
        provider.connection,
        payer,
        ansemwMint,
        buyer.publicKey,
        undefined,
        ANSEMW_TOKEN
      );
      await mintTo(
        provider.connection,
        payer,
        ansemwMint,
        buyerAnsemw,
        provider.wallet.publicKey,
        (ACTIVATION_COST + STAKE_AMOUNT) * ANSEMW_UNIT,
        undefined,
        undefined,
        ANSEMW_TOKEN
      );
      await activate(assetKey, buyer, buyerAnsemw);
      await stake(assetKey, buyer, buyerAnsemw, STAKE_AMOUNT);

      const buyersPiece = await program.account.position.fetch(positionPda);
      assert.strictEqual(buyersPiece.stakeBonusPct, 5, "buyer's own bonus");
      const poolBefore = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      // The seller pulls their own tokens out. This must touch nothing
      // but their own StakeAccount and their own token balance.
      await unstake(assetKey, kp, ansemw);

      const survived = await program.account.position.fetch(positionPda);
      assert.strictEqual(
        survived.stakeBonusPct,
        5,
        "the buyer's bonus survived the seller's withdrawal"
      );
      assert.strictEqual(
        survived.effectiveWeight.toNumber(),
        buyersPiece.effectiveWeight.toNumber(),
        "the piece's weight is untouched"
      );
      assert.strictEqual(
        (
          await program.account.rewardState.fetch(rewardStatePda)
        ).totalWeight.toNumber(),
        poolBefore,
        "the pool is untouched"
      );

      // And the seller genuinely got their tokens back.
      const back = await getAccount(
        provider.connection,
        ansemw,
        undefined,
        ANSEMW_TOKEN
      );
      assert.strictEqual(
        Number(back.amount),
        STAKE_AMOUNT * ANSEMW_UNIT,
        "the seller's own tokens came back in full"
      );
    });
  });
  describe("reap_burned", () => {
    /// A holder can burn their own asset straight through Metaplex,
    /// outside fuse. Nothing tells this program, so the position keeps
    /// its weight in total_weight - the denominator of every reward
    /// round - and dilutes everyone still holding, forever.
    it("returns the weight a directly-burned piece left behind", async () => {
      const { kp, assetKey, ansemw } = await makeHolder(ACTIVATION_COST);
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);

      const positionPda = positionPdaFor(assetKey);
      const stranded = (
        await program.account.position.fetch(positionPda)
      ).effectiveWeight.toNumber();
      const poolWithPiece = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();

      // Burn it the way a wallet would - this program is not involved.
      await burnAsset(
        umi,
        { publicKey: assetKey.toBase58() as any },
        { publicKey: collection.publicKey },
        umiSignerFor(umi, kp)
      );

      // The leak: the asset is gone, the weight is not.
      const poolLeaking = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();
      assert.strictEqual(
        poolLeaking,
        poolWithPiece,
        "burning left the weight behind - this is the bug"
      );

      // And sync_owner cannot reach it. It reverts on an asset it can
      // no longer read - MalformedCoreAsset rather than NotACoreAsset,
      // because a freshly burned account still reads as Core-owned with
      // its data truncated, and only later does the runtime hand it
      // back to the System Program. Either error leaves the position
      // unreachable through the normal path, which is the whole reason
      // reap_burned has to exist.
      await mustFail(
        program.methods.syncOwner().accounts({ asset: assetKey }).rpc(),
        "MalformedCoreAsset"
      );

      // reap_burned is the only way back.
      await program.methods
        .reapBurned()
        .accounts({
          asset: assetKey,
          rentReceiver: provider.wallet.publicKey,
        })
        .rpc();

      const poolAfter = (
        await program.account.rewardState.fetch(rewardStatePda)
      ).totalWeight.toNumber();
      assert.strictEqual(
        poolAfter,
        poolWithPiece - stranded,
        "the stranded weight is back out of the pool"
      );
      assert.isNull(
        await program.account.position.fetchNullable(positionPda),
        "the position is closed"
      );
    });

    it("refuses to touch a piece that still exists", async () => {
      const { kp, assetKey, ansemw } = await makeHolder(ACTIVATION_COST);
      await initPosition(assetKey);
      await activate(assetKey, kp, ansemw);

      // Permissionless is only safe because this is impossible.
      await mustFail(
        program.methods
          .reapBurned()
          .accounts({
            asset: assetKey,
            rentReceiver: provider.wallet.publicKey,
          })
          .rpc(),
        "AssetStillExists"
      );
    });
  });

  describe("activation cost ceiling", () => {
    it("refuses a value that would overflow the burn", async () => {
      const cfgBefore = await program.account.globalConfig.fetch(configPda);

      await mustFail(
        program.methods
          .setActivationCost(new anchor.BN("18446744073709551615"))
          .accounts({ authority: provider.wallet.publicKey })
          .rpc(),
        "ActivationCostTooHigh"
      );

      const cfgAfter = await program.account.globalConfig.fetch(configPda);
      assert.strictEqual(
        cfgAfter.activationCost.toString(),
        cfgBefore.activationCost.toString(),
        "the fee is unchanged"
      );
    });

    it("still allows lowering it, which is the direction that matters", async () => {
      const original = (await program.account.globalConfig.fetch(configPda))
        .activationCost;

      await program.methods
        .setActivationCost(new anchor.BN(1_000))
        .accounts({ authority: provider.wallet.publicKey })
        .rpc();
      assert.strictEqual(
        (
          await program.account.globalConfig.fetch(configPda)
        ).activationCost.toNumber(),
        1_000
      );

      await program.methods
        .setActivationCost(original)
        .accounts({ authority: provider.wallet.publicKey })
        .rpc();
    });
  });
  describe("derived metadata", () => {
    // Runs last on purpose. mint_nft only works once the collection's
    // update authority belongs to the config PDA - and the moment it
    // does, umi can no longer mint, which every earlier test relies on.
    before(async () => {
      await program.methods
        .claimCollectionAuthority()
        .accounts({
          authority: provider.wallet.publicKey,
          collection: toWeb3(collection.publicKey),
        })
        .rpc();
    });
    /// The whole point of dropping the name/uri arguments: what a buyer
    /// receives is decided by the counter, not by what they ask for.
    /// Before this, the first person to read the frontend's asset list
    /// could simply request the rarest piece - and since nothing in
    /// this program can rewrite an asset's metadata once Core has
    /// written it, that would have been permanent.
    it("names and points each piece from the counter, not the caller", async () => {
      const cfgBefore = await program.account.globalConfig.fetch(configPda);
      const n = cfgBefore.currentSupply + 1;

      const buyer = Keypair.generate();
      await airdrop(buyer.publicKey, 2);
      const asset = Keypair.generate();

      await program.methods
        .mintNft()
        .accounts({
          buyer: buyer.publicKey,
          asset: asset.publicKey,
          collection: toWeb3(collection.publicKey),
          treasury: treasuryDestination,
        })
        .signers([buyer, asset])
        .rpc();

      const onChain = await fetchCoreAsset(asset.publicKey);
      assert.strictEqual(onChain.name, `The Ansem World #${n}`);
      assert.strictEqual(onChain.uri, `${TEST_BASE_URI}${n}.json`);
    });

    it("gives consecutive buyers consecutive pieces", async () => {
      const start =
        (await program.account.globalConfig.fetch(configPda)).currentSupply + 1;

      const uris: string[] = [];
      for (let i = 0; i < 3; i++) {
        const buyer = Keypair.generate();
        await airdrop(buyer.publicKey, 2);
        const asset = Keypair.generate();
        await program.methods
          .mintNft()
          .accounts({
            buyer: buyer.publicKey,
            asset: asset.publicKey,
            collection: toWeb3(collection.publicKey),
            treasury: treasuryDestination,
          })
          .signers([buyer, asset])
          .rpc();
        uris.push((await fetchCoreAsset(asset.publicKey)).uri);
      }

      assert.deepStrictEqual(uris, [
        `${TEST_BASE_URI}${start}.json`,
        `${TEST_BASE_URI}${start + 1}.json`,
        `${TEST_BASE_URI}${start + 2}.json`,
      ]);
    });

    it("freezes the base URI once a piece exists", async () => {
      // Supply is well past zero by now, so the prefix is locked. The
      // escape hatch only covers a typo caught before the first sale.
      await mustFail(
        program.methods
          .setBaseUri("https://evil.example.com/")
          .accounts({ authority: provider.wallet.publicKey })
          .rpc(),
        "BaseUriLocked"
      );

      const cfg = await program.account.globalConfig.fetch(configPda);
      assert.strictEqual(cfg.baseUri, TEST_BASE_URI, "prefix unchanged");
    });
  });
});
