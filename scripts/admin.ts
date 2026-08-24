/**
 * Every lever the protocol authority has, in one place.
 *
 *   npm run admin                    what the protocol is doing
 *   npm run mint:live                open minting
 *   npm run mint:stop                close minting
 *   PRICE=0.25   npm run admin:price
 *   SUPPLY=3333  npm run admin:supply
 *   COST=30000   npm run admin:activation
 *   AMOUNT=5000  npm run admin:fund       (push $ANSEM into the reward pool)
 *   NEW=<pubkey> CONFIRM=yes npm run admin:authority
 *
 * Append :devnet to any of them to hit devnet instead of localhost.
 *
 * Checks that the program would reject are caught here first, so you
 * get a sentence instead of a hex error code.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { AnsemWorldV4 } from "../target/types/ansem_world_v4";

type Action =
  | "status"
  | "open"
  | "close"
  | "price"
  | "supply"
  | "activation"
  | "fund"
  | "authority";

const action = (process.env.ADMIN_ACTION ?? "status") as Action;
const n = (v: number) => v.toLocaleString("en-US");

describe(`admin:${action}`, () => {
  it(`runs ${action}`, async () => {
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

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Closing a program leaves a lot behind, and none of it is obvious.
    //
    // The program account itself survives, still flagged executable, and
    // so do every PDA it ever created - the config below reads back fine
    // long after nothing can execute against it. What actually gets
    // closed is the ProgramData account holding the bytecode, whose
    // address lives in bytes 4..36 of the program account. That is the
    // only reliable thing to check.
    const programInfo = await provider.connection.getAccountInfo(
      program.programId
    );
    const programDataAddr =
      programInfo && programInfo.data.length >= 36
        ? new PublicKey(programInfo.data.subarray(4, 36))
        : null;
    const programData = programDataAddr
      ? await provider.connection.getAccountInfo(programDataAddr)
      : null;

    if (!programInfo || !programData) {
      throw new Error(
        `program ${program.programId.toBase58()} is not deployed on ` +
        `${provider.connection.rpcEndpoint}.\n` +
        `  Config accounts may still read back, but they are orphans of a\n` +
        `  closed deployment and nothing can write to them again.`
      );
    }

    const cfg = await program.account.globalConfig.fetchNullable(configPda);
    if (!cfg) {
      throw new Error(
        `no protocol on ${provider.connection.rpcEndpoint} - run the setup first`
      );
    }

    // Every instruction below is authority-gated. Saying so here beats
    // a ConstraintRaw error after the transaction is already built.
    if (action !== "status" && !cfg.authority.equals(me)) {
      throw new Error(
        `you are not the authority\n` +
        `  authority: ${cfg.authority.toBase58()}\n` +
        `  you:       ${me.toBase58()}`
      );
    }

    const show = (c: any) => {
      const supply = Number(c.currentSupply);
      const max = Number(c.maxSupply);
      const live = !c.paused && c.collectionClaimed;
      console.log(`\n  cluster         ${provider.connection.rpcEndpoint}`);
      console.log(`  authority       ${c.authority.toBase58()}`);
      console.log(`  minting         ${live ? "LIVE" : "CLOSED"}`);
      if (!live) {
        console.log(
          `                  ${c.paused ? "(paused)" : ""}${
            !c.collectionClaimed ? "(collection authority not claimed)" : ""
          }`
        );
      }
      console.log(`  mint price      ${Number(c.mintPrice) / LAMPORTS_PER_SOL} SOL`);
      console.log(
        `  supply          ${n(supply)} / ${max === 0 ? "unlimited" : n(max)}`
      );
      console.log(`  activation cost ${n(Number(c.activationCost))} $ANSEMW`);
      console.log(`  paused          ${c.paused}`);
    };

    const after = async (label: string) => {
      const c = await program.account.globalConfig.fetch(configPda);
      console.log(`\n  ${label}`);
      show(c);
    };

    switch (action) {
      case "status":
        show(cfg);
        return;

      case "open":
      case "close": {
        const wantPaused = action === "close";
        if (cfg.paused === wantPaused) {
          console.log(`\n  already ${wantPaused ? "closed" : "live"}`);
          show(cfg);
          return;
        }
        if (!wantPaused && !cfg.collectionClaimed) {
          throw new Error(
            "unpausing will not open minting: the collection authority has " +
            "not been moved to the program yet"
          );
        }
        // Worth stating out loud: pause blocks claim too, so holders
        // cannot withdraw while it is on.
        if (wantPaused) {
          console.log(
            "\n  note: this also blocks activate, upgrade, fuse and claim"
          );
        }
        await program.methods.setPaused(wantPaused).accounts({ authority: me }).rpc();
        await after(wantPaused ? "minting closed" : "MINTING IS LIVE");
        return;
      }

      case "price": {
        const sol = Number(process.env.PRICE);
        if (!Number.isFinite(sol) || sol < 0) {
          throw new Error("set PRICE to the new mint price in SOL, e.g. PRICE=0.25");
        }
        const lamports = Math.round(sol * LAMPORTS_PER_SOL);
        await program.methods
          .setMintPrice(new anchor.BN(lamports))
          .accounts({ authority: me })
          .rpc();
        await after(`mint price is now ${sol} SOL`);
        return;
      }

      case "supply": {
        const max = Number(process.env.SUPPLY);
        if (!Number.isInteger(max) || max < 0) {
          throw new Error("set SUPPLY to the new cap, e.g. SUPPLY=3333 (0 = unlimited)");
        }
        const current = Number(cfg.maxSupply);
        const minted = Number(cfg.currentSupply);
        // Mirror the program's rules so the refusal is readable.
        if (max !== 0 && max < minted) {
          throw new Error(
            `cannot cap at ${n(max)}: ${n(minted)} are already minted`
          );
        }
        if (max !== 0 && current !== 0 && max > current) {
          throw new Error(
            `cannot raise the cap from ${n(current)} to ${n(max)}.\n` +
            `  Raising supply after launch dilutes everyone who bought into\n` +
            `  the old number, so the program only allows lowering it.`
          );
        }
        if (max === 0 && current !== 0) {
          console.log(
            "\n  warning: removing the cap entirely makes supply unlimited"
          );
        }
        await program.methods.setMaxSupply(max).accounts({ authority: me }).rpc();
        await after(`supply cap is now ${max === 0 ? "unlimited" : n(max)}`);
        return;
      }

      case "fund": {
        const amount = Number(process.env.AMOUNT);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("set AMOUNT to the $ANSEM to add, e.g. AMOUNT=5000");
        }
        // fund_rewards divides by active weight, so it reverts if nothing
        // is awake. Say so plainly instead of surfacing NoActiveWeight.
        const rs = await program.account.rewardState.fetch(
          PublicKey.findProgramAddressSync(
            [Buffer.from("reward_state")], program.programId
          )[0]
        );
        if (Number(rs.totalWeight) === 0) {
          throw new Error(
            "nothing is activated yet - there is no active weight to divide\n" +
            "  the reward among, so funding would revert. Wait until at least\n" +
            "  one piece is awake."
          );
        }
        // Check the wallet actually holds the $ANSEM, so a shortfall reads
        // as a balance problem rather than the token program's opaque
        // "insufficient funds" (custom error 0x1).
        const ata = getAssociatedTokenAddressSync(cfg.ansemMint, me);
        let held = 0;
        try {
          const bal = await provider.connection.getTokenAccountBalance(ata);
          held = Number(bal.value.uiAmount ?? 0);
        } catch {
          throw new Error(
            "this wallet has no $ANSEM account yet - it holds 0. Acquire " +
            "$ANSEM before funding the pool."
          );
        }
        if (held < amount) {
          throw new Error(
            `not enough $ANSEM: you hold ${held.toLocaleString("en-US")}, ` +
            `tried to fund ${amount.toLocaleString("en-US")}.`
          );
        }
        const raw = new anchor.BN(Math.round(amount * 1e6)); // $ANSEM has 6 decimals
        await program.methods
          .fundRewards(raw)
          .accounts({
            funder: me,
            funderAnsem: getAssociatedTokenAddressSync(cfg.ansemMint, me),
          })
          .rpc();
        await after(`funded ${amount.toLocaleString("en-US")} $ANSEM into the pool`);
        return;
      }

      case "activation": {
        const cost = Number(process.env.COST);
        if (!Number.isInteger(cost) || cost < 0) {
          throw new Error("set COST to the new activation cost, e.g. COST=30000");
        }
        await program.methods
          .setActivationCost(new anchor.BN(cost))
          .accounts({ authority: me })
          .rpc();
        await after(`activation now costs ${n(cost)} $ANSEMW`);
        return;
      }

      case "authority": {
        const raw = process.env.NEW;
        if (!raw) throw new Error("set NEW to the new authority pubkey");
        const next = new PublicKey(raw);
        // One-way in practice: only the new holder can hand it back.
        if (process.env.CONFIRM !== "yes") {
          throw new Error(
            `this hands the protocol to ${next.toBase58()} and you lose\n` +
            `  every admin power immediately. Only that key can give it back.\n` +
            `  Re-run with CONFIRM=yes if that is what you want.`
          );
        }
        await program.methods
          .transferAuthority(next)
          .accounts({ authority: me })
          .rpc();
        await after(`authority is now ${next.toBase58()}`);
        return;
      }
    }
  });
});
