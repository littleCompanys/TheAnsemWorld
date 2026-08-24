/**
 * End-to-end check of the fuse feed: activates nothing, just fuses
 * two pieces the CLI wallet already owns and reads the feed back.
 *
 *   npm run check:fuse
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";

describe("fuse feed", () => {
  it("records a fuse", async () => {
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(
      new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
        commitment: "processed",
        preflightCommitment: "processed",
      })
    );
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const program = anchor.workspace.ansemWorldV4 as Program<AnsemWorldV4>;
    const me = provider.wallet.publicKey;

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")], program.programId
    );
    const [feedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fuse_feed")], program.programId
    );
    const cfg = await program.account.globalConfig.fetch(configPda);

    // Every position this wallet can still fuse into.
    const positions = await program.account.position.all();
    const mine: PublicKey[] = [];
    for (const p of positions) {
      if ((p.account.absorbedCount as number) >= 2) continue;
      mine.push(p.account.asset as PublicKey);
      if (mine.length === 2) break;
    }
    if (mine.length < 2) throw new Error("need two fusable positions - run npm run seed");

    const [survivor, absorbed] = mine;
    console.log("  survivor:", survivor.toBase58());
    console.log("  absorbed:", absorbed.toBase58());

    const before = await (program.account as any).fuseFeed.fetch(feedPda);
    console.log("  feed total before:", Number(before.total));

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

    const after = await (program.account as any).fuseFeed.fetch(feedPda);
    const total = Number(after.total);
    console.log("  feed total after :", total);

    if (total !== Number(before.total) + 1) {
      throw new Error("feed did not record the fuse");
    }

    const idx = (Number(after.nextIndex) - 1 + after.entries.length) % after.entries.length;
    const e = after.entries[idx];
    console.log("  recorded entry:");
    console.log("    survivor:", (e.survivor as PublicKey).toBase58());
    console.log("    absorbed:", (e.absorbed as PublicKey).toBase58());
    console.log("    parts   :", Number(e.parts));
    console.log("    burned  :", Number(e.ansemwBurned).toLocaleString("en-US"), "$ANSEMW");
    console.log("    slot    :", Number(e.slot));

    if (!(e.survivor as PublicKey).equals(survivor)) throw new Error("survivor mismatch");
    if (!(e.absorbed as PublicKey).equals(absorbed)) throw new Error("absorbed mismatch");
  });
});
