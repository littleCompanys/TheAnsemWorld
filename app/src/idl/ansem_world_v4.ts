/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/ansem_world_v4.json`.
 */
export type AnsemWorldV4 = {
  "address": "8877byAeJpCUWQhBWXQ5YrBPSrBa9761koygiFP1ijtP",
  "metadata": {
    "name": "ansemWorldV4",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "activate",
      "docs": [
        "Burns the configured amount of $ANSEMW and switches the",
        "position on, adding its weight to the global total."
      ],
      "discriminator": [
        194,
        203,
        35,
        100,
        151,
        55,
        170,
        82
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "must be a real Core Asset, held by `owner`, and part of",
            "`config.core_collection`."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "ansemwMint",
          "writable": true
        },
        {
          "name": "ownerAnsemw",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "Withdraws the NFT's vault balance to the current holder's",
        "wallet. Settles first, so it always pays out everything",
        "earned up to this instant."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Must be the wallet that currently holds the NFT."
          ],
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "to the NFT, this check is what stands between a stranger and",
            "someone else's balance - it reads the holder from Core's own",
            "state, never from anything the caller supplies."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "rewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "ansemMint",
          "docs": [
            "Needed by transfer_checked (which Token-2022 requires in place",
            "of the bare transfer). Pinned to the configured mint by the",
            "has_one on `config` above, which also lets Anchor's client",
            "resolve it automatically."
          ],
          "relations": [
            "config"
          ]
        },
        {
          "name": "ownerAnsem",
          "docs": [
            "Funds can only ever move to the caller's own account."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimCollectionAuthority",
      "docs": [
        "Transfers the Core collection's update authority to the",
        "GlobalConfig PDA, locking all future minting behind this",
        "program. Must be called before mint_nft will work."
      ],
      "discriminator": [
        0,
        204,
        97,
        161,
        142,
        72,
        212,
        209
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Current collection update authority — must sign.",
            "After this instruction it will no longer be the authority."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "collection",
          "docs": [
            "Pinned to what was recorded at initialize_protocol."
          ],
          "writable": true
        },
        {
          "name": "mplCoreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "fundRewards",
      "docs": [
        "Deposits $ANSEM into the reward vault and spreads it across",
        "all currently active weight via the global accumulator."
      ],
      "discriminator": [
        114,
        64,
        163,
        112,
        175,
        167,
        19,
        121
      ],
      "accounts": [
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "ansemMint",
          "docs": [
            "Needed by transfer_checked (which Token-2022 requires in place",
            "of the bare transfer). Pinned to the configured mint by the",
            "has_one on `config` above, which also lets Anchor's client",
            "resolve it automatically."
          ],
          "relations": [
            "config"
          ]
        },
        {
          "name": "funderAnsem",
          "writable": true
        },
        {
          "name": "rewardVault",
          "docs": [
            "Pinned to the canonical vault PDA, so rewards can never be",
            "credited against tokens sitting in some other account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fuse",
      "docs": [
        "Merges one NFT into another: weights add, a bonus applies,",
        "the absorbed NFT is burned and its vault moves across."
      ],
      "discriminator": [
        217,
        196,
        80,
        243,
        178,
        186,
        12,
        156
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Must currently hold BOTH NFTs."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "survivorAsset"
        },
        {
          "name": "absorbedAsset",
          "writable": true
        },
        {
          "name": "collection",
          "docs": [
            "burn a collection member. Pinned to config."
          ],
          "writable": true
        },
        {
          "name": "survivor",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "survivorAsset"
              }
            ]
          }
        },
        {
          "name": "absorbed",
          "docs": [
            "Closed once its weight and vault have moved across - the NFT",
            "behind it no longer exists."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "absorbedAsset"
              }
            ]
          }
        },
        {
          "name": "ansemwMint",
          "writable": true
        },
        {
          "name": "ownerAnsemw",
          "writable": true
        },
        {
          "name": "mplCoreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "fuseFeed",
          "docs": [
            "The public record of this fuse."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  115,
                  101,
                  95,
                  102,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeFuseFeed",
      "docs": [
        "Creates the public fuse feed. Call once after",
        "initialize_protocol; fuse() cannot run without it."
      ],
      "discriminator": [
        5,
        255,
        161,
        81,
        239,
        105,
        96,
        6
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "docs": [
            "Proves the protocol exists before we hang a feed off it."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "fuseFeed",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  102,
                  117,
                  115,
                  101,
                  95,
                  102,
                  101,
                  101,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializePosition",
      "docs": [
        "Creates the Position PDA for one NFT. Starts inactive with",
        "zero economic effect - activate() is what turns it on."
      ],
      "discriminator": [
        219,
        192,
        234,
        71,
        190,
        191,
        102,
        80
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "asset",
          "docs": [
            "our collection. Ownership is deliberately not required -",
            "creating an asleep position is harmless, so anyone (a keeper",
            "backfilling the collection, for example) may do it."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeProtocol",
      "docs": [
        "Creates the two protocol-wide accounts (GlobalConfig,",
        "RewardState). Must be called exactly once, before anything",
        "else in the program can run."
      ],
      "discriminator": [
        188,
        233,
        252,
        106,
        134,
        146,
        202,
        91
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Whoever calls this becomes the protocol authority. Can only",
            "succeed once - the PDAs below already existing makes a second",
            "call fail."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "ansemMint",
          "docs": [
            "Passed as a real Mint account (not just a pubkey) so the",
            "runtime proves it actually is a mint before we record it."
          ]
        },
        {
          "name": "ansemwMint"
        },
        {
          "name": "rewardVault",
          "docs": [
            "The single global $ANSEM reward vault. It is its own",
            "authority, so only this program can move funds out of it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "docs": [
            "Collects royalties and trading fees in SOL."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeProtocolArgs"
            }
          }
        }
      ]
    },
    {
      "name": "initializeStakeVault",
      "docs": [
        "Creates the vault that holds locked $ANSEMW. Call once, after",
        "initialize_protocol and before the first stake."
      ],
      "discriminator": [
        125,
        55,
        104,
        34,
        35,
        179,
        67,
        3
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ansemwMint"
        },
        {
          "name": "stakeVault",
          "docs": [
            "The vault. Its own authority, so only the program signs unlocks."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "mintNft",
      "docs": [
        "Mints one World Piece NFT from the official collection and",
        "creates the corresponding Position PDA in one transaction.",
        "Charges mint_price SOL to the treasury.",
        "",
        "Takes no metadata: name and URI are derived from base_uri and",
        "the mint counter, so which piece a buyer gets is decided by",
        "when they minted, not by what they asked for."
      ],
      "discriminator": [
        211,
        57,
        6,
        167,
        15,
        219,
        35,
        251
      ],
      "accounts": [
        {
          "name": "buyer",
          "docs": [
            "The buyer — pays mint_price SOL + Position rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "asset",
          "docs": [
            "Fresh keypair generated client-side for this NFT.",
            "Must be a signer because Core uses the asset account's pubkey",
            "as the NFT's permanent address."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "collection",
          "writable": true
        },
        {
          "name": "treasury",
          "docs": [
            "Receives mint_price SOL. Pinned so no one can redirect revenue."
          ],
          "writable": true
        },
        {
          "name": "position",
          "docs": [
            "Position PDA for the new NFT. Created here so the buyer only",
            "needs one transaction to go from nothing to a registered piece."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "mplCoreProgram",
          "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "reapBurned",
      "docs": [
        "Clears a position whose NFT was burned outside fuse, returning",
        "its stranded weight to the pool. Permissionless."
      ],
      "discriminator": [
        26,
        72,
        91,
        226,
        66,
        58,
        188,
        96
      ],
      "accounts": [
        {
          "name": "asset",
          "docs": [
            "*gone*. The handler proves it is no longer a live Core asset",
            "before touching anything."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "rentReceiver",
          "docs": [
            "Whoever pays for the cleanup gets the Position's rent."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "reforge",
      "docs": [
        "Raises the tier of one part already fused into this NFT,",
        "priced off the same table as a normal upgrade."
      ],
      "discriminator": [
        63,
        85,
        190,
        223,
        113,
        79,
        243,
        120
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Must be the wallet currently holding the NFT."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "asset"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "ansemwMint",
          "writable": true
        },
        {
          "name": "ownerAnsemw",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "partIndex",
          "type": "u8"
        },
        {
          "name": "targetTier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "setActivationCost",
      "docs": [
        "Adjusts the wake-up fee, up to MAX_ACTIVATION_COST. Tier",
        "pricing stays immutable."
      ],
      "discriminator": [
        227,
        7,
        200,
        224,
        131,
        170,
        236,
        243
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "cost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setBaseUri",
      "docs": [
        "Corrects the metadata prefix. Only works before the first mint."
      ],
      "discriminator": [
        227,
        95,
        247,
        32,
        191,
        190,
        124,
        60
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "baseUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "setMaxSupply",
      "docs": [
        "Updates the hard supply cap."
      ],
      "discriminator": [
        16,
        207,
        140,
        77,
        107,
        20,
        202,
        158
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "max",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setMintPrice",
      "docs": [
        "Updates the SOL price per mint."
      ],
      "discriminator": [
        105,
        146,
        251,
        12,
        72,
        223,
        220,
        66
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Emergency stop. Blocks activate/upgrade/fund/claim; leaves",
        "settle_position and sync_owner working."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settlePosition",
      "docs": [
        "Credits a position's accrued earnings into the NFT's own",
        "vault. Permissionless - moves no tokens."
      ],
      "discriminator": [
        33,
        156,
        74,
        218,
        215,
        42,
        112,
        175
      ],
      "accounts": [
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.asset",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "stake",
      "docs": [
        "Locks $ANSEMW against one active piece, raising its earning bonus.",
        "One lock per piece; call again on the same piece to top up."
      ],
      "discriminator": [
        206,
        176,
        202,
        18,
        200,
        209,
        179,
        108
      ],
      "accounts": [
        {
          "name": "staker",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "staker"
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "stakeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "stakerAnsemw",
          "writable": true
        },
        {
          "name": "ansemwMint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset",
          "docs": [
            "the position PDA below."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "syncOwner",
      "docs": [
        "Puts a position to sleep once the NFT has changed hands.",
        "Permissionless; the new holder must burn $ANSEMW to wake it."
      ],
      "discriminator": [
        46,
        5,
        232,
        198,
        59,
        158,
        160,
        119
      ],
      "accounts": [
        {
          "name": "asset",
          "docs": [
            "recorded holder is what decides whether anything happens."
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "config",
          "docs": [
            "Needed to recompute the piece's weight after stripping any stake",
            "bonus. Read-only."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "transferAuthority",
      "docs": [
        "Moves protocol control to a new key, e.g. a multisig."
      ],
      "discriminator": [
        48,
        169,
        76,
        72,
        229,
        180,
        55,
        161
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "unstake",
      "docs": [
        "Returns the $ANSEMW locked against one piece and clears its bonus.",
        "No fee, no cooldown. Other staked pieces are untouched."
      ],
      "discriminator": [
        90,
        95,
        107,
        42,
        205,
        124,
        50,
        225
      ],
      "accounts": [
        {
          "name": "staker",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "stakeAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "staker"
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "owner",
          "relations": [
            "stakeAccount"
          ]
        },
        {
          "name": "stakeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "stakerAnsemw",
          "writable": true
        },
        {
          "name": "ansemwMint",
          "docs": [
            "Needed by transfer_checked (which Token-2022 requires in place",
            "of the bare transfer). Pinned by the has_one on `config`."
          ],
          "relations": [
            "config"
          ]
        },
        {
          "name": "asset"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "upgradeTier",
      "docs": [
        "Burns the difference in $ANSEMW to move the NFT up to",
        "`target_tier`, permanently raising what it earns. The tier",
        "stays with the NFT through any future sale."
      ],
      "discriminator": [
        122,
        56,
        170,
        60,
        252,
        234,
        190,
        51
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Must be the wallet currently holding the NFT."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "rewardState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "asset"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "asset"
              }
            ]
          }
        },
        {
          "name": "ansemwMint",
          "writable": true
        },
        {
          "name": "ownerAnsemw",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "withdrawTreasury",
      "docs": [
        "Sends collected revenue to the fixed treasury address so a",
        "keeper can swap it for $ANSEM off-chain and fund rewards."
      ],
      "discriminator": [
        40,
        63,
        122,
        158,
        144,
        216,
        83,
        96
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "fuseFeed",
      "discriminator": [
        27,
        71,
        209,
        191,
        230,
        246,
        118,
        30
      ]
    },
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "rewardState",
      "discriminator": [
        86,
        245,
        149,
        170,
        90,
        108,
        31,
        251
      ]
    },
    {
      "name": "stakeAccount",
      "discriminator": [
        80,
        158,
        67,
        124,
        50,
        189,
        192,
        255
      ]
    },
    {
      "name": "treasury",
      "discriminator": [
        238,
        239,
        123,
        238,
        89,
        1,
        168,
        253
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6001,
      "name": "alreadyActive",
      "msg": "NFT position is already active"
    },
    {
      "code": 6002,
      "name": "notActive",
      "msg": "NFT position is not active"
    },
    {
      "code": 6003,
      "name": "notAssetOwner",
      "msg": "Signer is not the current NFT owner"
    },
    {
      "code": 6004,
      "name": "invalidCollection",
      "msg": "The supplied Core asset does not belong to this collection"
    },
    {
      "code": 6005,
      "name": "invalidMint",
      "msg": "The supplied token mint is invalid"
    },
    {
      "code": 6006,
      "name": "activationOwnerMismatch",
      "msg": "Position activation owner does not match"
    },
    {
      "code": 6007,
      "name": "nothingToClaim",
      "msg": "Nothing available to claim"
    },
    {
      "code": 6008,
      "name": "insufficientRewardLiquidity",
      "msg": "Reward pool has insufficient ANSEM"
    },
    {
      "code": 6009,
      "name": "noActiveWeight",
      "msg": "No active weight exists"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6011,
      "name": "unauthorized",
      "msg": "Only the protocol authority can perform this action"
    },
    {
      "code": 6012,
      "name": "notACoreAsset",
      "msg": "Account is not owned by the Metaplex Core program"
    },
    {
      "code": 6013,
      "name": "malformedCoreAsset",
      "msg": "Core asset could not be deserialized"
    },
    {
      "code": 6014,
      "name": "invalidTierTable",
      "msg": "Tier thresholds and weights must both increase"
    },
    {
      "code": 6015,
      "name": "notAnUpgrade",
      "msg": "Target tier must be higher than the current tier"
    },
    {
      "code": 6016,
      "name": "invalidTier",
      "msg": "Target tier does not exist"
    },
    {
      "code": 6017,
      "name": "cannotFuseWithSelf",
      "msg": "An NFT cannot be fused with itself"
    },
    {
      "code": 6018,
      "name": "fuseLimitReached",
      "msg": "This NFT has already absorbed the maximum number of others"
    },
    {
      "code": 6019,
      "name": "noSuchPart",
      "msg": "This NFT has no absorbed part at that index"
    },
    {
      "code": 6020,
      "name": "mintSupplyExhausted",
      "msg": "Mint supply cap has been reached"
    },
    {
      "code": 6021,
      "name": "invalidMintMetadata",
      "msg": "NFT name or URI is empty or too long"
    },
    {
      "code": 6022,
      "name": "invalidStakeAmount",
      "msg": "Stake amount must be greater than zero"
    },
    {
      "code": 6023,
      "name": "notStaked",
      "msg": "This wallet has no stake"
    },
    {
      "code": 6024,
      "name": "stakeFocusMismatch",
      "msg": "The focused piece does not match this stake"
    },
    {
      "code": 6025,
      "name": "stakeTargetNotYours",
      "msg": "The piece must be active and activated by you to focus a stake on it"
    },
    {
      "code": 6026,
      "name": "stakeBonusOnFuse",
      "msg": "Unstake or unfocus before fusing a piece that carries a stake bonus"
    },
    {
      "code": 6027,
      "name": "invalidBaseUri",
      "msg": "Base URI is empty or too long"
    },
    {
      "code": 6028,
      "name": "baseUriLocked",
      "msg": "The base URI is frozen once the first piece has been minted"
    },
    {
      "code": 6029,
      "name": "activationCostTooHigh",
      "msg": "Activation cost is above the hard ceiling"
    },
    {
      "code": 6030,
      "name": "assetStillExists",
      "msg": "This asset still exists - nothing to reap"
    }
  ],
  "types": [
    {
      "name": "fuseEntry",
      "docs": [
        "One line in the public fuse history."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "survivor",
            "docs": [
              "The NFT that kept its identity."
            ],
            "type": "pubkey"
          },
          {
            "name": "absorbed",
            "docs": [
              "The NFT that was burned."
            ],
            "type": "pubkey"
          },
          {
            "name": "ansemwBurned",
            "docs": [
              "$ANSEMW burned to pay for this fuse."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot the fuse landed in, so the UI can order and date it."
            ],
            "type": "u64"
          },
          {
            "name": "parts",
            "docs": [
              "Parts the survivor is made of after this fuse (2 or 3)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "fuseFeed",
      "docs": [
        "One per protocol. Seed: [\"fuse_feed\"].",
        "",
        "A ring buffer of the most recent fuses. Every fuse is already a",
        "permanent on-chain fact, but reconstructing the list would mean",
        "scanning transactions. Writing it here costs one account and",
        "makes the whole history a single RPC read - no indexer, no",
        "backend."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nextIndex",
            "docs": [
              "Where the next entry goes. Wraps at FUSE_FEED_LEN."
            ],
            "type": "u8"
          },
          {
            "name": "total",
            "docs": [
              "Fuses ever recorded. Above FUSE_FEED_LEN it keeps counting,",
              "which is what lets the UI say \"of N total\" while only holding",
              "the last few."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "entries",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "fuseEntry"
                  }
                },
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "docs": [
        "One per protocol. Seed: [\"config\"].",
        "Holds every address/parameter the rest of the program needs to",
        "trust (which mints are real, which collection is official, who",
        "is allowed to change settings)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "ansemMint",
            "type": "pubkey"
          },
          {
            "name": "ansemwMint",
            "type": "pubkey"
          },
          {
            "name": "coreCollection",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "activationCost",
            "docs": [
              "Amount of $ANSEMW burned to wake a sleeping NFT. Charged on",
              "every activation, including after a resale. It does not move",
              "the NFT up a tier - tiers are bought separately."
            ],
            "type": "u64"
          },
          {
            "name": "tierThresholds",
            "docs": [
              "Cumulative $ANSEMW required to reach each tier, indexed by",
              "tier - 1. Upgrading charges the difference between two",
              "entries, which is what makes climbing in steps cost exactly",
              "the same as jumping straight to the top.",
              "",
              "Set once at initialization and never mutable afterwards: an",
              "authority able to move these could dilute every holder."
            ],
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "tierWeights",
            "docs": [
              "Earning weight at each tier, indexed by tier - 1. Integers",
              "rather than multipliers, so there is no rounding anywhere in",
              "the reward math."
            ],
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "fuseCosts",
            "docs": [
              "$ANSEMW burned to absorb the Nth NFT: index 0 is the second",
              "part, index 1 the third. Fixed at initialization for the",
              "same reason the tier table is."
            ],
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "rewardVaultBump",
            "docs": [
              "Bump of the reward vault PDA. Stored so instructions that",
              "move tokens out of the vault can sign deterministically",
              "instead of guessing."
            ],
            "type": "u8"
          },
          {
            "name": "mintPrice",
            "docs": [
              "SOL price (lamports) per NFT mint. Flows to treasury.",
              "Settable by the authority after launch."
            ],
            "type": "u64"
          },
          {
            "name": "maxSupply",
            "docs": [
              "Hard cap on total supply. Zero means unlimited."
            ],
            "type": "u32"
          },
          {
            "name": "currentSupply",
            "docs": [
              "Number of NFTs ever minted through this program."
            ],
            "type": "u32"
          },
          {
            "name": "collectionClaimed",
            "docs": [
              "True once claim_collection_authority has run. Guards mint_nft:",
              "the instruction would panic without a valid PDA signature."
            ],
            "type": "bool"
          },
          {
            "name": "baseUri",
            "docs": [
              "Prefix every piece's metadata URI is built from. The full URI is",
              "`{base_uri}{index}.json`, where index is the piece's mint order.",
              "",
              "This is what keeps metadata out of the caller's hands. mint_nft",
              "takes no name or uri argument at all, so the art a buyer receives",
              "is decided by when they minted, not by what they asked for -",
              "which is verifiable by anyone reading the chain.",
              "",
              "Mutable only while current_supply is 0, so a typo is fixable",
              "before the first mint and frozen forever after."
            ],
            "type": "string"
          },
          {
            "name": "reserved",
            "docs": [
              "Room for fields added later. Anchor lays accounts out in",
              "declaration order, so growing a live account means reallocating",
              "every one of them; paying for the space up front is far cheaper",
              "than migrating thousands of PDAs afterwards."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "initializeProtocolArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "coreCollection",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "activationCost",
            "type": "u64"
          },
          {
            "name": "tierThresholds",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "tierWeights",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "fuseCosts",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "mintPrice",
            "docs": [
              "SOL price (lamports) per mint. Can be updated later."
            ],
            "type": "u64"
          },
          {
            "name": "maxSupply",
            "docs": [
              "Hard supply cap. 0 = unlimited."
            ],
            "type": "u32"
          },
          {
            "name": "baseUri",
            "docs": [
              "Prefix each piece's metadata URI is built from - see",
              "GlobalConfig::base_uri. Changeable until the first mint."
            ],
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "position",
      "docs": [
        "One per NFT. Seed: [\"position\", asset_pubkey].",
        "Represents an NFT's *ability* to generate reward - not the",
        "reward itself. Rewards earned settle into UserReward, keyed by",
        "wallet, so they survive the NFT being sold."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "docs": [
              "The Metaplex Core Asset address this position tracks."
            ],
            "type": "pubkey"
          },
          {
            "name": "activationOwner",
            "docs": [
              "Wallet that called activate() for this NFT. Zeroed out while",
              "inactive."
            ],
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "tier",
            "docs": [
              "Reserved for future tier upgrades. Starts at 1."
            ],
            "type": "u8"
          },
          {
            "name": "baseWeight",
            "docs": [
              "Weight before any future tier/fuse bonuses."
            ],
            "type": "u64"
          },
          {
            "name": "effectiveWeight",
            "docs": [
              "The weight actually used in reward math right now."
            ],
            "type": "u64"
          },
          {
            "name": "rewardDebt",
            "docs": [
              "Snapshot of RewardState.acc_reward_per_weight the last time",
              "this position's earnings were settled into a UserReward."
            ],
            "type": "u128"
          },
          {
            "name": "cumulativeAnsemwBurned",
            "docs": [
              "Total $ANSEMW ever burned to (re)activate this NFT."
            ],
            "type": "u64"
          },
          {
            "name": "absorbedCount",
            "docs": [
              "How many other NFTs this one has absorbed. Drives the fuse",
              "bonus and, with it, the ceiling on further fusing."
            ],
            "type": "u8"
          },
          {
            "name": "absorbedTiers",
            "docs": [
              "Tier of each absorbed part, in the order they were taken in.",
              "Only the first `absorbed_count` entries mean anything.",
              "Reforge raises these; upgrade_tier never touches them."
            ],
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "vaultBalance",
            "docs": [
              "$ANSEM credited to this NFT and not yet withdrawn.",
              "This is the NFT's vault: it belongs to the token, not to a",
              "wallet, so it travels with the NFT when it is sold. Only the",
              "current holder can withdraw it, and only to their own wallet."
            ],
            "type": "u64"
          },
          {
            "name": "lifetimeEarned",
            "docs": [
              "Lifetime $ANSEM ever credited to this NFT, for display."
            ],
            "type": "u64"
          },
          {
            "name": "stakeBonusPct",
            "docs": [
              "Stake bonus currently applied to this piece, as a percentage",
              "(0, 5, 10, 15, 20, 25). Set when a wallet focuses its $ANSEMW",
              "stake here, cleared on unstake and on a sale. Only ever nonzero",
              "while the staker still holds and has activated the piece."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "See GlobalConfig::reserved. Costs ~0.00045 SOL of extra rent per",
              "piece, paid by the buyer at mint - the price of never having to",
              "realloc 3,333 accounts."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "rewardState",
      "docs": [
        "One per protocol. Seed: [\"reward_state\"].",
        "Global accounting for the accumulator-based reward math, so we",
        "never have to loop over every NFT when rewards are funded."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalWeight",
            "docs": [
              "Sum of effective_weight from all currently active positions."
            ],
            "type": "u64"
          },
          {
            "name": "accRewardPerWeight",
            "docs": [
              "Global reward-per-weight accumulator (scaled by PRECISION)."
            ],
            "type": "u128"
          },
          {
            "name": "totalAllocated",
            "docs": [
              "Total $ANSEM ever credited into the accounting (may exceed",
              "what's claimable due to rounding dust)."
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "docs": [
              "Total $ANSEM ever paid out via claim()."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "See GlobalConfig::reserved."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "stakeAccount",
      "docs": [
        "One per (wallet, piece). Seed: [\"stake\", owner, asset].",
        "Holds how much $ANSEMW a wallet has locked against one specific piece.",
        "A wallet can hold several of these at once - one per piece it boosts -",
        "and each piece's bonus tier is derived from its own lock alone. The",
        "bonus itself lives on that piece's Position; this account is the",
        "record of what backs it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "asset",
            "docs": [
              "The piece this lock boosts. Fixed for the life of the account -",
              "the seed binds it, so a lock can never drift to another piece."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "$ANSEMW locked against `asset`. The bonus tier is derived from",
              "this, never stored, so the two can never disagree."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasury",
      "docs": [
        "Program-owned SOL account. Seed: [\"treasury\"].",
        "",
        "Where protocol revenue lands: NFT resale royalties and trading",
        "fees. Anyone can pay into it - it is a plain address as far as",
        "the sender is concerned - but only the authority can move funds",
        "out, and only to be converted into $ANSEM.",
        "",
        "Conversion itself is deliberately NOT here. Swapping through",
        "Jupiter is an off-chain keeper job; this program stays the",
        "source of truth for reward accounting and never lets a swap",
        "result decide what anyone is owed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalWithdrawn",
            "docs": [
              "Lamports ever taken out for conversion. Current holdings are",
              "simply the account's balance, so collected-to-date is",
              "balance + withdrawn - rent."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "See GlobalConfig::reserved."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    }
  ]
};
