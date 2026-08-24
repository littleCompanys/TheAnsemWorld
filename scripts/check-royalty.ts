/**
 * Proves the royalty setup works, without a marketplace.
 *
 *   npm run check:royalty[:devnet]
 *
 * Magic Eden's devnet API is gone (its instruction routes answer 503
 * "failure to get a peer from the ring-balancer" - no backend at all),
 * so the buy/sell round trip cannot be rehearsed there. What a
 * marketplace actually does, though, is read the royalty plugin off the
 * asset and split the sale price accordingly. That part is entirely
 * checkable here:
 *
 *   1. the collection carries a Royalties plugin
 *   2. it pays the project treasury, at the expected rate
 *   3. a piece minted through the program inherits it
 *   4. the plugin survives a transfer between wallets
 *   5. a sale at a given price owes the treasury what we expect
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fetchCollection, fetchAsset } from "@metaplex-foundation/mpl-core";
import { publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";
import { makeUmi, transferAsset, ROYALTY_BASIS_POINTS } from "../tests/core-helpers";

const SALE_PRICE_SOL = 2;

describe("royalties", () => {
  it("are attached, inherited, and survive a sale", async () => {
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
    const umi = makeUmi(provider.connection.rpcEndpoint, payer);

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")], program.programId
    );
    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")], program.programId
    );
    const cfg = await program.account.globalConfig.fetch(configPda);

    // ── 1 & 2: the plugin on the collection ────────────────────────
    const collection = await fetchCollection(
      umi,
      umiPublicKey(cfg.coreCollection.toBase58())
    );
    const r = (collection as any).royalties;
    if (!r) throw new Error("collection has no Royalties plugin");

    console.log("\n  collection      ", cfg.coreCollection.toBase58());
    console.log("  basis points    ", r.basisPoints, `(${r.basisPoints / 100}%)`);
    console.log("  rule set        ", r.ruleSet?.type ?? r.ruleSet);
    for (const c of r.creators) {
      const isTreasury = c.address.toString() === treasuryPda.toBase58();
      console.log(
        `  creator          ${c.address} ${c.percentage}%` +
        (isTreasury ? "  <- project treasury" : "")
      );
    }

    if (r.basisPoints !== ROYALTY_BASIS_POINTS) {
      throw new Error(
        `expected ${ROYALTY_BASIS_POINTS} bps, found ${r.basisPoints}`
      );
    }
    const total = r.creators.reduce((s: number, c: any) => s + c.percentage, 0);
    if (total !== 100) throw new Error(`creator split is ${total}%, not 100%`);
    if (!r.creators.some((c: any) => c.address.toString() === treasuryPda.toBase58())) {
      throw new Error("treasury is not among the royalty creators");
    }

    // ── 3: a piece minted through the program inherits it ──────────
    const asset = Keypair.generate();
    await program.methods
      .mintNft()
      .accounts({
        buyer: provider.wallet.publicKey,
        asset: asset.publicKey,
        collection: cfg.coreCollection,
        treasury: cfg.treasury,
      })
      .signers([asset])
      .rpc();

    // fetchAsset resolves collection plugins by default, which is what a
    // marketplace sees. Fetching again with that turned off shows where
    // the royalty physically lives: on the collection, not on the piece.
    const asMarketplaceSeesIt = await fetchAsset(
      umi,
      umiPublicKey(asset.publicKey.toBase58())
    );
    const ownPluginsOnly = await fetchAsset(
      umi,
      umiPublicKey(asset.publicKey.toBase58()),
      { skipDerivePlugins: true }
    );
    const seen = (asMarketplaceSeesIt as any).royalties;
    const own = (ownPluginsOnly as any).royalties;

    console.log("\n  minted piece    ", asset.publicKey.toBase58());
    console.log(
      "  marketplace sees",
      seen ? `${seen.basisPoints} bps` : "NOTHING"
    );
    console.log(
      "  stored on piece ",
      own ? `${own.basisPoints} bps` : "no - inherited from the collection"
    );
    if (!seen || seen.basisPoints !== ROYALTY_BASIS_POINTS) {
      throw new Error("a freshly minted piece does not carry the royalty");
    }

    // ── 4: it survives changing hands ──────────────────────────────
    const buyer = Keypair.generate();
    await transferAsset(
      umi,
      { publicKey: asset.publicKey.toBase58() as any },
      { publicKey: cfg.coreCollection.toBase58() as any },
      umi.identity,
      buyer.publicKey
    );
    const afterSale = await fetchCollection(
      umi,
      umiPublicKey(cfg.coreCollection.toBase58())
    );
    if ((afterSale as any).royalties?.basisPoints !== ROYALTY_BASIS_POINTS) {
      throw new Error("royalty changed after a transfer");
    }
    console.log("  after transfer   royalty intact, new owner", buyer.publicKey.toBase58());

    // ── 5: what a sale at SALE_PRICE_SOL owes ──────────────────────
    const owed = (SALE_PRICE_SOL * ROYALTY_BASIS_POINTS) / 10_000;
    const treasuryBalance =
      (await provider.connection.getBalance(treasuryPda)) / LAMPORTS_PER_SOL;
    console.log(`\n  sale simulation  ${SALE_PRICE_SOL} SOL`);
    console.log(`    to treasury    ${owed} SOL`);
    console.log(`    to seller      ${SALE_PRICE_SOL - owed} SOL`);
    console.log(`    treasury holds ${treasuryBalance} SOL today`);
    console.log(
      `\n  At 1,000 SOL of yearly secondary volume that is ` +
      `${(1000 * ROYALTY_BASIS_POINTS) / 10_000} SOL a year, ` +
      `recurring - unlike mint revenue, which happens once.`
    );
  });
});
