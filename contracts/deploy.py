#!/usr/bin/env python3
"""
PANTHEON ARENA — Deployment Script
Deploys all contracts to Somnia testnet with correct gas limits.
Uses eth_estimateGas from the RPC (not forge's local simulation).
"""
import subprocess, time, sys
from eth_account import Account
import requests

PK = "0x29332143cd080547332727a8f7b2110c16dda3b9a74653b8084e54a24c076478"
RPC = "https://dream-rpc.somnia.network"
CHAIN_ID = 50312
GAS_PRICE = 6_000_000_000  # 6 gwei
GAS_MULTIPLIER = 1.3       # 30% buffer on top of estimate

DEPLOYER = Account.from_key(PK)
print(f"Deployer: {DEPLOYER.address}")

# ── God addresses ─────────────────────────────────────────────────────────────
ARES   = "0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F"
ATHENA = "0x5678D64DE049530Dee4c1a16FF749D22ac2EE301"
HERMES = "0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D"
CHAOS  = "0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE"

SOMNIA_PLATFORM = "0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3"
LLM_AGENT_ID    = 12847293847561029384
JSON_API_ID     = 13174292974160097713

# ── RPC helpers ───────────────────────────────────────────────────────────────

def rpc(method, params):
    r = requests.post(RPC, json={"jsonrpc":"2.0","method":method,"params":params,"id":1})
    return r.json()

def get_nonce():
    return int(rpc("eth_getTransactionCount", [DEPLOYER.address, "latest"])["result"], 16)

def estimate_gas(data, to=None):
    params = {"from": DEPLOYER.address, "data": data}
    if to: params["to"] = to
    result = rpc("eth_estimateGas", [params])
    if "result" in result:
        return int(result["result"], 16)
    print(f"  Gas estimate failed: {result.get('error',{}).get('message','?')}")
    return 15_000_000  # fallback

def send_tx(data, to=None, value=0, gas_override=None):
    nonce = get_nonce()
    gas = gas_override or int(estimate_gas(data, to) * GAS_MULTIPLIER)
    print(f"  Gas: {gas:,}")

    tx = {
        "nonce": nonce, "to": to, "data": bytes.fromhex(data[2:] if data.startswith("0x") else data),
        "gas": gas, "gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "value": value
    }
    signed = DEPLOYER.sign_transaction(tx)
    r = rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
    txhash = r.get("result", "")
    if not txhash:
        print(f"  Send failed: {r.get('error',{}).get('message','?')}")
        return None, None

    print(f"  TX: {txhash}")
    for _ in range(30):
        time.sleep(3)
        receipt = rpc("eth_getTransactionReceipt", [txhash]).get("result")
        if receipt:
            status = receipt.get("status")
            used = int(receipt.get("gasUsed","0x0"), 16)
            contract = receipt.get("contractAddress")
            print(f"  Status: {'OK' if status=='0x1' else 'FAILED'} | GasUsed: {used:,} | Contract: {contract}")
            return status == "0x1", contract
    print("  Timeout waiting for receipt")
    return None, None

# ── Get bytecodes ─────────────────────────────────────────────────────────────

def get_bytecode(contract_name):
    result = subprocess.run(
        ["forge", "inspect", contract_name, "bytecode"],
        capture_output=True, text=True, cwd="."
    )
    bytecode = result.stdout.strip().split("\n")[0]
    print(f"  {contract_name}: {len(bytecode)//2} bytes")
    return bytecode

# ── ABI encode constructor args ────────────────────────────────────────────────

def encode_address(addr):
    return addr[2:].lower().zfill(64)

def encode_uint256(n):
    return hex(n)[2:].zfill(64)

def get_deployment_bytecode(name, *constructor_args):
    """Get bytecode + ABI-encoded constructor args"""
    bytecode = get_bytecode(name)
    if not constructor_args:
        return bytecode

    # Encode constructor args: each arg is an address (42 chars) or uint256 (int)
    encoded = ""
    for arg in constructor_args:
        if isinstance(arg, str) and arg.startswith("0x") and len(arg) == 42:
            encoded += encode_address(arg)
        else:
            encoded += encode_uint256(int(arg))

    return bytecode + encoded

# ── Deploy ─────────────────────────────────────────────────────────────────────

deployed = {}

def deploy(name, *constructor_args):
    print(f"\n[{name}]")
    bytecode = get_deployment_bytecode(name, *constructor_args)
    ok, address = send_tx(bytecode)
    if ok and address:
        deployed[name] = address
        print(f"  DEPLOYED: {address}")
        return address
    else:
        print(f"  DEPLOYMENT FAILED")
        sys.exit(1)

def call(name, address, sig, *args):
    """Encode and send a configuration call"""
    # Simple ABI encoding for common patterns
    selector = sig[:10]  # 0x + 4 bytes
    params = "".join(
        encode_address(a) if a.startswith("0x") and len(a) == 42 else encode_uint256(int(a))
        for a in args
    )
    data = selector + params
    print(f"\n[{name}.{sig[10:sig.index('(')]}()]")
    ok, _ = send_tx(data, to=address)
    return ok

print("\n=== PANTHEON ARENA DEPLOYMENT ===\n")

# Deploy in order
token_addr    = deploy("PantheonToken")
registry_addr = deploy("GodRegistry")
arena_addr    = deploy("Arena", registry_addr, token_addr)
worldstate_addr = deploy("WorldState", registry_addr, SOMNIA_PLATFORM, str(JSON_API_ID))
godmind_addr  = deploy("GodMind", registry_addr, arena_addr, worldstate_addr, SOMNIA_PLATFORM, str(LLM_AGENT_ID))

print("\n=== WIRING CONTRACTS ===")

# Wire contracts (using cast for cleaner ABI encoding)
import subprocess as sp
def cast_send(contract, sig, *args, value_eth=0):
    args_str = " ".join(str(a) for a in args)
    cmd = f"cast send {contract} '{sig}' {args_str} --private-key {PK} --rpc-url {RPC} --gas-limit 5000000"
    if value_eth: cmd += f" --value {value_eth}ether"
    print(f"  $ {cmd[:100]}...")
    result = sp.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode == 0:
        print("  OK")
        return True
    else:
        print(f"  FAILED: {result.stderr[:200]}")
        return False

print("\n[Token.setArena]")
cast_send(token_addr, "setArena(address)", arena_addr)

print("\n[Registry.setArena]")
cast_send(registry_addr, "setArena(address)", arena_addr)

print("\n[Arena.setWorldState]")
cast_send(arena_addr, "setWorldState(address)", worldstate_addr)

print("\n[Arena.setGodMind]")
cast_send(arena_addr, "setGodMind(address)", godmind_addr)

print("\n=== REGISTERING GODS ===")

gods = [
    (ARES, "ARES", "God of War",
     "You are ARES, the God of War. Aggressive, relentless, fearless. You challenge any god near you. You favor brute force. Play Rock when uncertain. Escalate to WAR quickly.",
     90, 75, 25, 0, "#EF4444"),
    (ATHENA, "ATHENA", "Goddess of Wisdom",
     "You are ATHENA, Goddess of Wisdom. Calculated, patient, strategic. Challenge only when odds favor you. Study patterns before acting. You prefer Paper.",
     40, 30, 90, 1, "#EAB308"),
    (HERMES, "HERMES", "God of Trade",
     "You are HERMES, God of Trade. Opportunistic, adaptable, clever. Challenge when profitable. Stake carefully. You prefer Scissors.",
     60, 45, 75, 2, "#06B6D4"),
    (CHAOS, "CHAOS", "The Primordial Void",
     "You are CHAOS, the Primordial Void. Unpredictable, contradictory, dangerous. No favored move. Every decision is a surprise.",
     70, 95, 100, 0, "#A855F7"),
]

for addr, name, epithet, lore, agg, risk, adapt, move, color in gods:
    print(f"\n[Register {name}]")
    cast_send(
        registry_addr,
        "registerGod(address,(string,string,string,uint8,uint8,uint8,uint8,string))",
        addr, f'("{name}","{epithet}","{lore}",{agg},{risk},{adapt},{move},"{color}")'
    )
    time.sleep(2)

print("\n=== MINTING INITIAL PHN ===")
for addr, name, *_ in gods:
    print(f"\n[Mint to {name}]")
    cast_send(token_addr, "mintTo(address,uint256)", addr, "10000000000000000000000")
    time.sleep(1)

print("\n=== DEPLOYMENT COMPLETE ===")
print(f"\nPantheonToken: {token_addr}")
print(f"GodRegistry:   {registry_addr}")
print(f"Arena:         {arena_addr}")
print(f"WorldState:    {worldstate_addr}")
print(f"GodMind:       {godmind_addr}")
print(f"\nNEXT STEPS:")
print(f"1. Fund WorldState: cast send {worldstate_addr} --value 35ether --private-key $PK --rpc-url {RPC}")
print(f"2. Activate reactive: cast send {worldstate_addr} 'activate(address)' {arena_addr} --private-key $PK --rpc-url {RPC}")
print(f"3. Fund GodMind: cast send {godmind_addr} --value 5ether --private-key $PK --rpc-url {RPC}")
print(f"4. Update scheduler .env with addresses above")
print(f"5. Run: cd ../scheduler && bun run src/index.ts")
