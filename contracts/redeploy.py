#!/usr/bin/env python3
"""Redeploy Arena + WorldState with all fixes, wire everything, update configs."""
import subprocess, time, sys
from eth_account import Account
from eth_utils import to_checksum_address
import requests

PK   = "0x29332143cd080547332727a8f7b2110c16dda3b9a74653b8084e54a24c076478"
RPC  = "https://dream-rpc.somnia.network"
CHAIN = 50312

acct = Account.from_key(PK)

# Existing addresses (unchanged)
TOKEN    = "0xbFA7e8478b3de2392A07ffa674e5D21215898103"
REGISTRY = "0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897"
GOD_MIND = "0x697c4fa37d25fefaec317dc4c9f4282f7471200f"

# Somnia agent
PLATFORM   = "0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3"
LLM_ID     = 12847293847561029384
JSON_API_ID = 13174292974160097713

def rpc(method, params):
    r = requests.post(RPC, json={"jsonrpc":"2.0","method":method,"params":params,"id":1})
    return r.json()

def nonce():
    return int(rpc("eth_getTransactionCount", [acct.address, "latest"])["result"], 16)

def estimate(data, to=None):
    p = {"from": acct.address, "data": data}
    if to: p["to"] = to
    r = rpc("eth_estimateGas", [p])
    if "result" in r: return int(r["result"], 16)
    return 50_000_000

def send(data, to=None, value=0, label="tx"):
    n = nonce()
    gas = int(estimate(data, to) * 1.4)
    tx = {"nonce": n, "to": to_checksum_address(to) if to else None,
          "data": bytes.fromhex(data[2:] if data.startswith("0x") else data),
          "gas": gas, "gasPrice": 6_000_000_000, "chainId": CHAIN, "value": value}
    signed = acct.sign_transaction(tx)
    r = rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
    txhash = r.get("result", "")
    if not txhash:
        print(f"  {label}: FAILED to broadcast: {r.get('error',{}).get('message','?')}")
        return None, None
    print(f"  {label}: {txhash[:20]}…")
    time.sleep(12)
    receipt = rpc("eth_getTransactionReceipt", [txhash]).get("result", {})
    ok = receipt.get("status") == "0x1"
    addr = receipt.get("contractAddress")
    used = int(receipt.get("gasUsed","0x0"), 16)
    status = "OK" if ok else "FAIL"
    print(f"  → {status} | gas={used:,}" + (f" | addr={addr}" if addr else ""))
    return ok, addr

def bytecode(name):
    r = subprocess.run(["forge", "inspect", name, "bytecode"],
                       capture_output=True, text=True, cwd=".")
    return r.stdout.strip().split("\n")[0]

def enc_addr(a): return to_checksum_address(a)[2:].lower().zfill(64)
def enc_uint(n): return hex(int(n))[2:].zfill(64)

def call_fn(to, sig, *args):
    """Encode and send a function call."""
    import hashlib
    selector = hashlib.sha3_256(sig.encode()).digest()[:4].hex()
    params = ""
    for a in args:
        if isinstance(a, str) and a.startswith("0x") and len(a) == 42:
            params += enc_addr(a)
        else:
            params += enc_uint(int(a))
    data = "0x" + selector + params
    ok, _ = send(data, to=to, label=sig[:sig.index("(")])
    return ok

print(f"\n{'='*50}")
print("PANTHEON ARENA — REDEPLOYMENT")
print(f"{'='*50}\n")
print(f"Deployer: {acct.address}")
bal = int(rpc("eth_getBalance", [acct.address, "latest"])["result"], 16)
print(f"Balance:  {bal/1e18:.4f} STT\n")

# ── 1. Deploy Arena ────────────────────────────────────────────────────────────
print("[1] Deploying Arena (reveal fix)...")
arena_bc = bytecode("Arena")
full_arena = arena_bc + enc_addr(REGISTRY) + enc_addr(TOKEN)
ok, ARENA = send(full_arena, label="Arena deploy")
if not ok:
    print("Arena deployment failed. Exiting.")
    sys.exit(1)
print(f"    Arena: {ARENA}")

# ── 2. Deploy WorldState ───────────────────────────────────────────────────────
print("\n[2] Deploying WorldState (topic fix)...")
ws_bc = bytecode("WorldState")
full_ws = ws_bc + enc_addr(REGISTRY) + enc_addr(PLATFORM) + enc_uint(JSON_API_ID)
ok, WORLD_STATE = send(full_ws, label="WorldState deploy")
if not ok:
    print("WorldState deployment failed. Exiting.")
    sys.exit(1)
print(f"    WorldState: {WORLD_STATE}")

# ── 3. Wire all contracts ──────────────────────────────────────────────────────
print("\n[3] Wiring contracts...")
call_fn(TOKEN,       "setArena(address)",      ARENA)
call_fn(REGISTRY,    "setArena(address)",      ARENA)
call_fn(ARENA,       "setWorldState(address)", WORLD_STATE)
call_fn(ARENA,       "setGodMind(address)",    GOD_MIND)
call_fn(GOD_MIND,    "setAgentConfig(address,uint256)", PLATFORM, str(LLM_ID))

# ── 4. Fund WorldState for reactive subscription (32 STT min) ─────────────────
print("\n[4] Funding WorldState with 35 STT...")
ok, _ = send("0x", to=WORLD_STATE, value=35*10**18, label="fund WorldState")

# ── 5. Activate reactive subscription ─────────────────────────────────────────
print("\n[5] Activating WorldState reactive subscription...")
call_fn(WORLD_STATE, "activate(address)", ARENA)

# ── 6. Fund GodMind ────────────────────────────────────────────────────────────
print("\n[6] Funding GodMind with 5 STT...")
ok, _ = send("0x", to=GOD_MIND, value=5*10**18, label="fund GodMind")

# ── 7. Verify ─────────────────────────────────────────────────────────────────
print("\n[7] Verifying...")
sub_id = rpc("eth_call", [{"to": WORLD_STATE, "data": "0x" + "e2f9d25b"}, "latest"]).get("result","0x0")
print(f"    Subscription ID: {int(sub_id,16)}")
god_count = rpc("eth_call", [{"to": REGISTRY, "data": "0x" + "18685569"}, "latest"]).get("result","0x0")
print(f"    God count: {int(god_count,16)}")

print(f"\n{'='*50}")
print("DEPLOYMENT COMPLETE")
print(f"{'='*50}")
print(f"Arena:      {ARENA}")
print(f"WorldState: {WORLD_STATE}")
print(f"GodMind:    {GOD_MIND} (unchanged)")
print(f"\nUpdate these in:")
print(f"  scheduler/.env")
print(f"  frontend/lib/contracts/config.ts")
