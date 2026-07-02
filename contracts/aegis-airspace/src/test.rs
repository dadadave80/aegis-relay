#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, U256};

use crate::{AirspaceContract, AirspaceContractClient, CorridorInfo, Error};

/// Register the contract with a freshly generated authority. Returns the client
/// and the authority address. Auth is NOT mocked here — callers decide.
fn setup(env: &Env) -> (AirspaceContractClient<'_>, Address) {
    let authority = Address::generate(env);
    let id = env.register(AirspaceContract, (authority.clone(),));
    (AirspaceContractClient::new(env, &id), authority)
}

/// Happy path: approve a corridor, read back the exact raw record (no time
/// filtering).
#[test]
fn roundtrip_approve_then_read() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _authority) = setup(&env);

    let root = U256::from_u32(&env, 777);
    client.approve_corridor(&1u32, &root, &100u64, &200u64);

    let info = client.corridor(&1u32);
    assert_eq!(
        info,
        CorridorInfo {
            root,
            valid_from: 100,
            valid_to: 200,
        },
        "corridor must roundtrip exactly (raw, unfiltered by time)"
    );
}

/// `approve_corridor` without the authority's authorization must be rejected.
/// No auth is mocked, so `authority.require_auth()` fails.
#[test]
fn unauthorized_root() {
    let env = Env::default();
    let (client, _authority) = setup(&env);

    let root = U256::from_u32(&env, 1);
    let res = client.try_approve_corridor(&1u32, &root, &0u64, &1u64);
    assert!(
        res.is_err(),
        "approve_corridor without authority auth must be rejected"
    );
}

/// `valid_from >= valid_to` is rejected with `InvalidWindow` (both the equal and
/// the reversed case).
#[test]
fn invalid_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _authority) = setup(&env);

    let root = U256::from_u32(&env, 5);

    // Equal endpoints: empty window.
    let equal = client.try_approve_corridor(&1u32, &root, &100u64, &100u64);
    assert_eq!(
        equal,
        Err(Ok(Error::InvalidWindow)),
        "valid_from == valid_to must be rejected"
    );

    // Reversed endpoints.
    let reversed = client.try_approve_corridor(&1u32, &root, &200u64, &100u64);
    assert_eq!(
        reversed,
        Err(Ok(Error::InvalidWindow)),
        "valid_from > valid_to must be rejected"
    );
}

/// Two lanes are stored independently, and re-approving a lane overwrites its
/// record.
#[test]
fn lanes_independent_and_overwrite() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _authority) = setup(&env);

    let root_a = U256::from_u32(&env, 11);
    let root_b = U256::from_u32(&env, 22);
    client.approve_corridor(&1u32, &root_a, &10u64, &20u64);
    client.approve_corridor(&2u32, &root_b, &30u64, &40u64);

    // Independent storage.
    assert_eq!(client.corridor(&1u32).root, root_a, "lane 1 keeps its own root");
    assert_eq!(client.corridor(&2u32).root, root_b, "lane 2 keeps its own root");
    assert_eq!(client.corridor(&2u32).valid_from, 30u64);

    // Re-approving lane 1 overwrites it, leaving lane 2 untouched.
    let root_a2 = U256::from_u32(&env, 111);
    client.approve_corridor(&1u32, &root_a2, &50u64, &60u64);
    assert_eq!(
        client.corridor(&1u32),
        CorridorInfo {
            root: root_a2,
            valid_from: 50,
            valid_to: 60,
        },
        "re-approval must overwrite lane 1"
    );
    assert_eq!(client.corridor(&2u32).root, root_b, "lane 2 must be untouched");
}

/// Reading an unknown lane panics with `Error::UnknownLane` (contract error #1).
#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn corridor_unknown_lane_panics() {
    let env = Env::default();
    let (client, _authority) = setup(&env);
    client.corridor(&99u32);
}
