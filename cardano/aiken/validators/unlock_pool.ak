use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}
use zk_stables_bridge/types.{RegistryDatum, RegistryRedeemer}

const max_registry_nonces: Int = 64

fn append_nonce(xs: List<ByteArray>, nonce: ByteArray) -> List<ByteArray> {
  list.concat(xs, [nonce])
}

validator unlock_pool(operator: VerificationKeyHash) {
  spend(
    datum: Option<RegistryDatum>,
    redeemer: RegistryRedeemer,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    expect Some(reg) = datum
    let RegistryRedeemer { nonce } = redeemer
    expect Some(own_input) =
      list.find(transaction.inputs, fn(i) { i.output_reference == own_ref })
    expect Address { payment_credential: Script(own_script), stake_credential: _ } =
      own_input.output.address
    let expected_next = append_nonce(reg.used_nonces, nonce)
    let continuing =
      list.any(
        transaction.outputs,
        fn(out) { output_extends_registry(out, own_script, expected_next) },
      )
    and {
      list.has(transaction.extra_signatories, operator),
      bytearray.length(nonce) <= 64,
      list.length(reg.used_nonces) < max_registry_nonces,
      !list.has(reg.used_nonces, nonce),
      continuing,
    }
  }

  else(_) {
    fail
  }
}

fn output_extends_registry(
  out: Output,
  script_hash: ByteArray,
  expected_nonces: List<ByteArray>,
) -> Bool {
  when out.address.payment_credential is {
    Script(h) ->
      if h == script_hash {
        when out.datum is {
          InlineDatum(raw) -> {
            expect r: RegistryDatum = raw
            r.used_nonces == expected_nonces
          }
          _ -> False
        }
      } else {
        False
      }
    _ -> False
  }
}
