/**
 * Proves the chain, not the caller, decides what a buyer receives.
 *
 *   npm run check:metadata[:devnet]
 *
 * mint_nft used to take `name` and `uri` as arguments. The instruction
 * is permissionless and always will be - the discriminator is derivable
 * from the instruction name alone - so the first buyer who read the
 * frontend's asset list could simply ask for the rarest piece. Nothing
 * in this program can rewrite an asset's metadata once Core has written
 * it, so that would have been permanent.
 *
 * This mints two pieces back to back and reads the name and URI back
 * off Core, where only Core could have written them. If they follow the
 * counter, the caller had no say.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";
import { makeUmi, readAssetMetadata } from "../tests/core-helpers";
import { assert } from "chai";

describe("check:metadata", () => {
  it("derives every piece's name and URI from the mint counter", async () => {
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
    const umi = makeUmi(
      provider.connection.rpcEndpoint,
      (provider.wallet as anchor.Wallet).payer
    );

    const [cfgPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const cfg = await program.account.globalConfig.fetch(cfgPda);

    // Nothing to ask for: the argument list is empty. Anchor may hand
    // back the IDL with camelCased names, so accept either spelling
    // rather than silently finding nothing and reading `.args` of it.
    const ix = (program.idl.instructions as any[]).find(
      (i) => i.name === "mint_nft" || i.name === "mintNft"
    );
    assert.isDefined(ix, "mint_nft not found in the IDL");
    const args = ix.args;
    console.log("\n  mint_nft args :", args.length === 0 ? "NONE" : args);
    assert.strictEqual(args.length, 0, "mint_nft still takes metadata");

    console.log("  base_uri      :", cfg.baseUri);
    console.log("  supply before :", cfg.currentSupply);
    if (cfg.paused) throw new Error("minting is paused - run mint:live first");

    const start = cfg.currentSupply + 1;
    for (let i = 0; i < 2; i++) {
      const n = start + i;
      const asset = Keypair.generate();
      await program.methods
        .mintNft()
        .accounts({
          buyer: me,
          asset: asset.publicKey,
          collection: cfg.coreCollection,
          treasury: cfg.treasury,
        })
        .signers([asset])
        .rpc();

      // Read it back from Core, the only writer of this state.
      const md = await readAssetMetadata(umi, asset.publicKey);
      console.log(`\n  piece #${n}  ${asset.publicKey.toBase58()}`);
      console.log(`    name -> ${md.name}`);
      console.log(`    uri  -> ${md.uri}`);

      assert.strictEqual(md.name, `The Ansem World #${n}`);
      assert.strictEqual(md.uri, `${cfg.baseUri}${n}.json`);
    }

    const after = await program.account.globalConfig.fetch(cfgPda);
    console.log("\n  supply after  :", after.currentSupply);
    assert.strictEqual(after.currentSupply, cfg.currentSupply + 2);
    console.log("  the counter chose both pieces - the caller could not.\n");
  });
});
