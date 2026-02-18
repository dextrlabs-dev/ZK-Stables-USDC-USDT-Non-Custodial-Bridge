use aiken/collection/list
use cardano/assets.{quantity_of}
use cardano/transaction.{OutputReference, Transaction}
use zk_stables_bridge/types.{LockDatum}

/// Redeemer must live in this module so nullary constructors resolve in `when` (see aiken gift_card Action).
pub type LockRedeemer {
  UserRefund
  BridgeRelease
}

validator lock_pool {
  spend(
    datum: Option<LockDatum>,
    redeemer: LockRedeemer,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(d) = datum
    expect Some(own_input) =
      list.find(transaction.inputs, fn(i) { i.output_reference == own_ref })
    let locked =
      quantity_of(own_input.output.value, d.policy_id, d.asset_name)
    and {
      locked >= d.amount,
      when redeemer is {
        UserRefund -> list.has(transaction.extra_signatories, d.depositor)
        BridgeRelease ->
          when d.bridge_operator is {
            Some(op) -> list.has(transaction.extra_signatories, op)
            None -> list.has(transaction.extra_signatories, d.recipient)
          }
      },
    }
  }

  else(_) {
    fail
  }
}
