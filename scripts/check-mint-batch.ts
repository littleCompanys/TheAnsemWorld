/**
 * Reproduces the batch mint the Mint page builds: N mint_nft
 * instructions packed into as few transactions as fit, each asset
 * keypair partial-signing. Uses the app's IDL copy, like the browser.
 *
 *   npm run check:mint
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  type TransactionInstruction,
} from "@solana/web3.js";

import appIdl from "../app/src/idl/ansem_world_v4.json";

const QTY = 5;
const TX_SIZE_LIMIT = 1100;
const COLLECTION_NAME = "The Ansem World";

describe("batch mint", () => {
  it("mints QTY pieces the way the Mint page does", async () => {
    const envProvider = anchor.AnchorProvider.env();
    anchor.setProvider(
      new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
        commitment: "processed",
        preflightCommitment: "processed",
      })
    );
    const provider = anchor.getProvider() as anchor.AnchorProvider;
    const connection = provider.connection;
    const me = provider.wallet.publicKey;

    const program = new Program(appIdl as any, provider);
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const cfg = await (program.account as any).globalConfig.fetch(configPda);

    console.log("  buyer   :", me.toBase58());
    console.log(
      "  balance :",
      (await connection.getBalance(me)) / 1e9,
      "SOL"
    );
    console.log("  treasury:", (cfg.treasury as PublicKey).toBase58());
    console.log(
      "  treasury balance:",
      (await connection.getBalance(cfg.treasury as PublicKey)) / 1e9,
      "SOL"
    );
    console.log("  mint price:", Number(cfg.mintPrice) / 1e9, "SOL");
    console.log("  supply:", Number(cfg.currentSupply), "/", Number(cfg.maxSupply));

    const supplyCursor = Number(cfg.currentSupply);
    const pieces: { ix: TransactionInstruction; asset: Keypair }[] = [];

    for (let i = 0; i < QTY; i++) {
      const asset = Keypair.generate();
      const n = supplyCursor + 1 + i;
      const ix = await program.methods
        .mintNft(`${COLLECTION_NAME} #${n}`, `http://localhost:5173/nft/1.json`)
        .accounts({
          buyer: me,
          asset: asset.publicKey,
          collection: cfg.coreCollection,
          treasury: cfg.treasury,
        })
        .instruction();
      pieces.push({ ix, asset });
    }

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");

    const size = (tx: Transaction) =>
      tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        .length;

    const newBatch = () => {
      const tx = new Transaction();
      tx.feePayer = me;
      tx.recentBlockhash = blockhash;
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
      return { tx, assets: [] as Keypair[] };
    };

    const batches: { tx: Transaction; assets: Keypair[] }[] = [];
    let batch = newBatch();
    for (const p of pieces) {
      const trial = new Transaction();
      trial.feePayer = me;
      trial.recentBlockhash = blockhash;
      for (const e of batch.tx.instructions) trial.add(e);
      trial.add(p.ix);
      if (size(trial) > TX_SIZE_LIMIT && batch.tx.instructions.length > 1) {
        batches.push(batch);
        batch = newBatch();
      }
      batch.tx.add(p.ix);
      batch.assets.push(p.asset);
    }
    if (batch.assets.length > 0) batches.push(batch);

    console.log(`  packed ${QTY} mints into ${batches.length} tx`);
    batches.forEach((b, i) =>
      console.log(
        `    tx${i + 1}: ${b.assets.length} mints, ${size(b.tx)} bytes`
      )
    );

    for (const [i, b] of batches.entries()) {
      b.tx.partialSign(...b.assets);
      const signed = await (provider.wallet as any).signTransaction(b.tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      console.log(`    tx${i + 1} confirmed`);
    }

    const after = await (program.account as any).globalConfig.fetch(configPda);
    console.log("  supply after:", Number(after.currentSupply));
    if (Number(after.currentSupply) !== supplyCursor + QTY) {
      throw new Error("supply did not advance by QTY");
    }
  });
});
