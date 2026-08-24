/**
 * Exercises the exact path the browser takes: builds the Program from
 * the IDL copy the app imports (app/src/idl), fuses two pieces, then
 * reads the feed back the way useFuseFeed does.
 *
 * The workspace tests use target/idl. That copy being right says
 * nothing about the one Vite bundles, and a stale app IDL is what
 * shifts the fuse account list and produces "owned by a different
 * program than expected".
 *
 *   npm run check:ui
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// The very file app/src/lib/program.ts imports.
import appIdl from "../app/src/idl/ansem_world_v4.json";

describe("frontend fuse path", () => {
  it("fuses and reads the feed using the app's IDL", async () => {
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(
      new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
        commitment: "processed",
        preflightCommitment: "processed",
      })
    );
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const me = provider.wallet.publicKey;

    // Built the same way getProgram() builds it in the browser.
    const program = new Program(appIdl as any, provider);

    const pda = (seed: string) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from(seed)],
        program.programId
      )[0];

    const cfg = await (program.account as any).globalConfig.fetch(pda("config"));

    const positions = await (program.account as any).position.all();
    const fusable = positions
      .filter((p: any) => (p.account.absorbedCount as number) < 2)
      .map((p: any) => p.account.asset as PublicKey);
    if (fusable.length < 2) {
      throw new Error("need two fusable positions - run npm run seed");
    }
    const [survivor, absorbed] = fusable;

    const feedBefore = await (program.account as any).fuseFeed.fetchNullable(
      pda("fuse_feed")
    );
    if (!feedBefore) throw new Error("fuse feed missing - run npm run seed");
    const totalBefore = Number(feedBefore.total);

    // Exactly the call Forge.tsx makes. fuse_feed is deliberately NOT
    // listed: Anchor resolves it from the IDL seeds, and if the app's
    // IDL is stale this is the line that breaks.
    await program.methods
      .fuse()
      .accounts({
        owner: me,
        survivorAsset: survivor,
        absorbedAsset: absorbed,
        collection: cfg.coreCollection,
        ansemwMint: cfg.ansemwMint,
        ownerAnsemw: getAssociatedTokenAddressSync(cfg.ansemwMint, me),
      })
      .rpc();

    // Now the useFuseFeed decode, step for step.
    const feed = await (program.account as any).fuseFeed.fetch(pda("fuse_feed"));
    const entries = feed.entries as any[];
    const len = entries.length;
    const count = Math.min(Number(feed.total), len);
    const nextIndex = Number(feed.nextIndex);

    const items: any[] = [];
    for (let k = 1; k <= count; k++) {
      const e = entries[(nextIndex - k + len) % len];
      items.push({
        survivor: e.survivor as PublicKey,
        absorbed: e.absorbed as PublicKey,
        ansemwBurned: Number(e.ansemwBurned),
        slot: Number(e.slot),
        parts: Number(e.parts),
      });
    }

    console.log(`  feed: ${totalBefore} -> ${Number(feed.total)}`);
    console.log(`  rows the UI would render: ${items.length}`);
    for (const it of items) {
      console.log(
        `    ${it.survivor.toBase58().slice(0, 6)} absorbed ` +
          `${it.absorbed.toBase58().slice(0, 6)} · ${it.parts} parts · ` +
          `${it.ansemwBurned.toLocaleString("en-US")} $ANSEMW · slot ${it.slot}`
      );
    }

    if (Number(feed.total) !== totalBefore + 1) {
      throw new Error("feed did not record the fuse");
    }
    const newest = items[0];
    if (!newest.survivor.equals(survivor)) throw new Error("survivor mismatch");
    if (!newest.absorbed.equals(absorbed)) throw new Error("absorbed mismatch");
    if (newest.ansemwBurned <= 0) throw new Error("burned amount not recorded");
  });
});
