#!/usr/bin/env python3
"""Deploy a new NarratorAgent with the correct LLM-Inference deposit math.

Confirmed by the Somnia team on Shannon: validators silently skip requests
unless the deposit covers floor + (0.07 STT * 3 validators). Old NarratorAgent
only sent floor, so totalGenerated stayed at 0. This redeploy fixes that.
"""
import subprocess, time, sys, os
from eth_account import Account
from eth_utils import to_checksum_address
import requests

# Reuse the deployer key from the existing redeploy script
PK   = "0x29332143cd080547332727a8f7b2110c16dda3b9a74653b8084e54a24c076478"
RPC  = "https://dream-rpc.somnia.network"
CHAIN = 50312
acct = Account.from_key(PK)

def rpc(method, params):
    r = requests.post(RPC, json={"jsonrpc":"2.0","method":method,"params":params,"id":1})
    return r.json()

def nonce():
    return int(rpc("eth_getTransactionCount", [acct.address, "latest"])["result"], 16)

def send_deploy(bytecode, label):
    n = nonce()
    tx = {
        "nonce": n,
        "to": None,
        "data": bytes.fromhex(bytecode[2:] if bytecode.startswith("0x") else bytecode),
        "gas": 50_000_000,
        "gasPrice": 6_000_000_000,
        "chainId": CHAIN,
        "value": 0,
    }
    signed = acct.sign_transaction(tx)
    r = rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
    txhash = r.get("result")
    if not txhash:
        print(f"BROADCAST FAILED: {r}")
        sys.exit(1)
    print(f"  {label} tx: {txhash}")
    print(f"  waiting for receipt...")
    for _ in range(30):
        time.sleep(2)
        receipt = rpc("eth_getTransactionReceipt", [txhash]).get("result")
        if receipt:
            status = receipt.get("status")
            addr = receipt.get("contractAddress")
            gas = int(receipt.get("gasUsed","0x0"), 16)
            if status == "0x1":
                print(f"  OK  gas={gas:,}  addr={addr}")
                return addr
            print(f"  FAIL status={status}")
            sys.exit(1)
    print("  TIMEOUT waiting for receipt")
    sys.exit(1)

def get_bytecode(name):
    r = subprocess.run(["forge", "inspect", name, "bytecode"],
                       capture_output=True, text=True, cwd=os.path.dirname(__file__) or ".")
    out = r.stdout.strip()
    if not out.startswith("0x"):
        print(f"forge inspect failed: {r.stderr}")
        sys.exit(1)
    return out

if __name__ == "__main__":
    print(f"deployer: {acct.address}")
    print(f"chain:    {CHAIN} (Shannon)")
    print()
    print("fetching NarratorAgent bytecode...")
    bc = get_bytecode("NarratorAgent")
    print(f"  bytecode size: {len(bc)//2 - 1} bytes")
    print()
    print("deploying NarratorAgent...")
    addr = send_deploy(bc, "NarratorAgent")
    print()
    print(f"NEW_NARRATOR_AGENT={addr}")
