use zk_stables_bridge/types.{LockDatum}

test lock_datum_constructible() {
  expect LockDatum {
    depositor: _,
    recipient: _,
    policy_id: _,
    asset_name: _,
    amount: amt,
    lock_nonce: nonce,
    recipient_commitment: _,
    source_chain_id: _,
    destination_chain_id: _,
    bridge_operator: _,
  } =
    LockDatum {
      depositor: #"00000000000000000000000000000000000000000000000000000000",
      recipient: #"11111111111111111111111111111111111111111111111111111111",
      policy_id: #"",
      asset_name: #"",
      amount: 1_000_000,
      lock_nonce: 42,
      recipient_commitment: #"0000000000000000000000000000000000000000000000000000000000000000",
      source_chain_id: 1,
      destination_chain_id: 2,
      bridge_operator: None,
    }
  and {
    amt == 1_000_000,
    nonce == 42,
  }
}
