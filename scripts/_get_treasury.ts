import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/ansem_world_v4.json";

const PROGRAM_ID = new PublicKey("9Ku7jCnxjyJuUiyXscjKk5ueMPpWQnUTwpLKZfzErq2E");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

(async () => {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
  console.log("config PDA:", configPda.toBase58());

  const provider = new anchor.AnchorProvider(connection, {} as any, {});
  const program = new anchor.Program(idl as any, provider);
  const cfg: any = await (program.account as any).globalConfig.fetch(configPda);
  console.log("treasury:", cfg.treasury.toBase58());
  console.log("ansemMint:", cfg.ansemMint?.toBase58?.());
  console.log("mintPrice:", cfg.mintPrice?.toString?.());
})();
