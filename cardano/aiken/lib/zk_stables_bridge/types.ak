use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{AssetName, PolicyId}

/// On-chain fields that align with [`contract/docs/DEPOSIT_COMMITMENT_ENCODING.md`](../../contract/docs/DEPOSIT_COMMITMENT_ENCODING.md):
/// off-chain builds `event_commitment` from policy/name, observed txid, output_index, and `lock_nonce`.
pub type LockDatum {
  depositor: VerificationKeyHash,
  recipient: VerificationKeyHash,
  policy_id: PolicyId,
  asset_name: AssetName,
  amount: Int,
  lock_nonce: Int,
  recipient_commitment: ByteArray,
  source_chain_id: Int,
  destination_chain_id: Int,
  bridge_operator: Option<VerificationKeyHash>,
}

pub type RegistryDatum {
  used_nonces: List<ByteArray>,
}

pub type RegistryRedeemer {
  nonce: ByteArray,
}
