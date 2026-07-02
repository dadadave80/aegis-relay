#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, U256};

use crate::{CredentialsContract, CredentialsContractClient, Error};

/// Register the contract with a freshly generated issuer. Returns the client
/// and the issuer address. Auth is NOT mocked here — callers decide.
fn setup(env: &Env) -> (CredentialsContractClient<'_>, Address) {
    let issuer = Address::generate(env);
    let id = env.register(CredentialsContract, (issuer.clone(),));
    (CredentialsContractClient::new(env, &id), issuer)
}

/// Happy path: publish a root, read back the exact values; a later epoch
/// overwrites cleanly.
#[test]
fn roundtrip_set_then_read() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _issuer) = setup(&env);

    let root = U256::from_u32(&env, 123_456);
    client.set_root(&root, &7u32);

    let (got_root, got_epoch) = client.current();
    assert_eq!(got_root, root, "root must roundtrip exactly");
    assert_eq!(got_epoch, 7u32, "epoch must roundtrip exactly");

    // A strictly greater epoch overwrites.
    let root2 = U256::from_u32(&env, 999);
    client.set_root(&root2, &8u32);
    let (r2, e2) = client.current();
    assert_eq!(r2, root2, "later root must overwrite");
    assert_eq!(e2, 8u32, "later epoch must overwrite");
}

/// `set_root` without the issuer's authorization must be rejected. No auth is
/// mocked, so `issuer.require_auth()` fails (mirrors v1's auth-guard test).
#[test]
fn unauthorized_root() {
    let env = Env::default();
    let (client, _issuer) = setup(&env);

    let root = U256::from_u32(&env, 1);
    let res = client.try_set_root(&root, &1u32);
    assert!(res.is_err(), "set_root without issuer auth must be rejected");
}

/// Epoch must be strictly increasing: the same epoch and a lower epoch are both
/// rejected; a higher epoch is accepted.
#[test]
fn epoch_not_increasing() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _issuer) = setup(&env);

    let root = U256::from_u32(&env, 42);
    client.set_root(&root, &5u32);

    // Same epoch rejected.
    let same = client.try_set_root(&root, &5u32);
    assert_eq!(
        same,
        Err(Ok(Error::EpochNotIncreasing)),
        "same epoch must be rejected"
    );

    // Lower epoch rejected.
    let lower = client.try_set_root(&root, &4u32);
    assert_eq!(
        lower,
        Err(Ok(Error::EpochNotIncreasing)),
        "lower epoch must be rejected"
    );

    // Stored epoch is untouched by the rejections; a higher epoch is accepted.
    client.set_root(&root, &6u32);
    assert_eq!(client.current().1, 6u32, "higher epoch must be accepted");
}

/// Reading before any root is published panics with `Error::NoRoot` (contract
/// error #1).
#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn current_before_set_panics() {
    let env = Env::default();
    let (client, _issuer) = setup(&env);
    client.current();
}
