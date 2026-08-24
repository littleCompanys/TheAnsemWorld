import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";

// Usage: pass any Core asset pubkey as argv[2]
// e.g.: ts-node scripts/decode_asset.ts <ASSET_PUBKEY>
(async () => {
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const key = new PublicKey(process.argv[2]);
  const info = await conn.getAccountInfo(key);
  if (!info) { console.error("account not found"); process.exit(1); }
  const d = info.data;
  console.log("total bytes:", d.length);
  console.log("hex (first 120 bytes):", d.subarray(0, 120).toString("hex"));
  // Try to find the name string by scanning for a u32 length prefix followed by ASCII
  for (let i = 0; i < d.length - 4; i++) {
    const len = d.readUInt32LE(i);
    if (len > 0 && len < 200 && i + 4 + len <= d.length) {
      const slice = d.subarray(i + 4, i + 4 + len);
      if (slice.every(b => b >= 32 && b < 127)) {
        console.log(`  offset ${i}: len=${len} value="${slice.toString("utf8")}"`);
      }
    }
  }
})();
