#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, Vec,
};

pub const LEDGERS_PER_DAY: u32 = 17_280;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    Policy(Address),
    DailySpend(Address, u32),
    /// Ledger at which the owner revoked the agent's policy.
    RevokedPolicy(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WalletConfig {
    pub owner: Address,
    pub upto_session_contract: Address,
    pub initialized_at_ledger: u32,
    pub example_only: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpendingPolicy {
    pub agent: Address,
    pub max_amount_per_payment: i128,
    pub max_amount_per_day: i128,
    pub valid_until_ledger: u32,
    pub allowed_sellers: Vec<Address>,
    pub allowed_assets: Vec<Address>,
    pub allowed_resource_hashes: Vec<BytesN<32>>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyWalletError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidPolicy = 3,
    PolicyNotFound = 4,
    PolicyExpired = 5,
    InvalidAmount = 6,
    AmountExceedsPaymentCap = 7,
    AmountExceedsDailyCap = 8,
    SellerNotAllowed = 9,
    AssetNotAllowed = 10,
    ResourceHashNotAllowed = 11,
    PolicyRevoked = 12,
}

/// Emitted once when the owner revokes an agent's policy.
#[contractevent]
pub struct AgentPolicyRevoked {
    #[topic]
    pub agent: Address,
    pub owner: Address,
    pub revoked_at_ledger: u32,
}

#[contract]
pub struct PolicyWalletExampleContract;

#[contractimpl]
impl PolicyWalletExampleContract {
    pub fn initialize(
        env: Env,
        owner: Address,
        upto_session_contract: Address,
    ) -> Result<(), PolicyWalletError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(PolicyWalletError::AlreadyInitialized);
        }

        owner.require_auth();

        let config = WalletConfig {
            owner,
            upto_session_contract,
            initialized_at_ledger: env.ledger().sequence(),
            example_only: true,
        };
        env.storage().instance().set(&DataKey::Config, &config);

        Ok(())
    }

    pub fn get_config(env: Env) -> Result<WalletConfig, PolicyWalletError> {
        read_config(&env)
    }

    pub fn require_owner(env: Env) -> Result<(), PolicyWalletError> {
        require_owner_auth(&env)?;
        Ok(())
    }

    pub fn set_policy(env: Env, policy: SpendingPolicy) -> Result<(), PolicyWalletError> {
        require_owner_auth(&env)?;
        validate_policy(
            &env,
            policy.max_amount_per_payment,
            policy.max_amount_per_day,
            policy.valid_until_ledger,
            &policy.allowed_sellers,
            &policy.allowed_assets,
            &policy.allowed_resource_hashes,
        )?;

        let agent = policy.agent.clone();
        // Setting a policy is an explicit re-grant and clears a revocation.
        env.storage()
            .instance()
            .remove(&DataKey::RevokedPolicy(agent.clone()));
        env.storage()
            .instance()
            .set(&DataKey::Policy(agent), &policy);

        Ok(())
    }

    /// Owner-only: removes the agent's policy so every later check and
    /// authorization fails with `PolicyRevoked`. Revoking an agent that never
    /// had a policy fails with `PolicyNotFound`; revoking twice fails with
    /// `PolicyRevoked`. Daily-spend records and other agents are untouched.
    pub fn revoke_policy(env: Env, agent: Address) -> Result<(), PolicyWalletError> {
        let owner = read_config(&env)?.owner;
        owner.require_auth();
        if env
            .storage()
            .instance()
            .has(&DataKey::RevokedPolicy(agent.clone()))
        {
            return Err(PolicyWalletError::PolicyRevoked);
        }
        let policy_key = DataKey::Policy(agent.clone());
        if !env.storage().instance().has(&policy_key) {
            return Err(PolicyWalletError::PolicyNotFound);
        }

        let revoked_at_ledger = env.ledger().sequence();
        env.storage().instance().remove(&policy_key);
        env.storage()
            .instance()
            .set(&DataKey::RevokedPolicy(agent.clone()), &revoked_at_ledger);
        AgentPolicyRevoked {
            agent,
            owner,
            revoked_at_ledger,
        }
        .publish(&env);
        Ok(())
    }

    /// Ledger at which the agent's policy was revoked, if it is revoked.
    pub fn get_policy_revocation(env: Env, agent: Address) -> Option<u32> {
        env.storage().instance().get(&DataKey::RevokedPolicy(agent))
    }

    pub fn get_policy(env: Env, agent: Address) -> Result<SpendingPolicy, PolicyWalletError> {
        read_policy(&env, &agent)
    }

    pub fn check_payment(
        env: Env,
        agent: Address,
        seller: Address,
        asset: Address,
        amount: i128,
        resource_hash: BytesN<32>,
    ) -> Result<(), PolicyWalletError> {
        validate_payment(&env, &agent, &seller, &asset, amount, &resource_hash)?;
        Ok(())
    }

    pub fn authorize_payment(
        env: Env,
        agent: Address,
        seller: Address,
        asset: Address,
        amount: i128,
        resource_hash: BytesN<32>,
    ) -> Result<(), PolicyWalletError> {
        agent.require_auth();
        validate_payment(&env, &agent, &seller, &asset, amount, &resource_hash)?;

        let ledger_day = current_ledger_day(&env);
        let spent = read_daily_spend(&env, &agent, ledger_day);
        let next_spent = spent
            .checked_add(amount)
            .ok_or(PolicyWalletError::AmountExceedsDailyCap)?;
        env.storage()
            .instance()
            .set(&DataKey::DailySpend(agent, ledger_day), &next_spent);

        Ok(())
    }

    pub fn spent_today(env: Env, agent: Address) -> i128 {
        read_daily_spend(&env, &agent, current_ledger_day(&env))
    }

    pub fn example_only(_env: Env) -> bool {
        true
    }
}

fn read_config(env: &Env) -> Result<WalletConfig, PolicyWalletError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(PolicyWalletError::NotInitialized)
}

fn require_owner_auth(env: &Env) -> Result<(), PolicyWalletError> {
    read_config(env)?.owner.require_auth();
    Ok(())
}

fn read_policy(env: &Env, agent: &Address) -> Result<SpendingPolicy, PolicyWalletError> {
    if env
        .storage()
        .instance()
        .has(&DataKey::RevokedPolicy(agent.clone()))
    {
        return Err(PolicyWalletError::PolicyRevoked);
    }
    env.storage()
        .instance()
        .get(&DataKey::Policy(agent.clone()))
        .ok_or(PolicyWalletError::PolicyNotFound)
}

fn validate_policy(
    env: &Env,
    max_amount_per_payment: i128,
    max_amount_per_day: i128,
    valid_until_ledger: u32,
    allowed_sellers: &Vec<Address>,
    allowed_assets: &Vec<Address>,
    allowed_resource_hashes: &Vec<BytesN<32>>,
) -> Result<(), PolicyWalletError> {
    if max_amount_per_payment <= 0
        || max_amount_per_day <= 0
        || max_amount_per_payment > max_amount_per_day
        || allowed_sellers.is_empty()
        || allowed_assets.is_empty()
        || allowed_resource_hashes.is_empty()
    {
        return Err(PolicyWalletError::InvalidPolicy);
    }

    if valid_until_ledger <= env.ledger().sequence() {
        return Err(PolicyWalletError::PolicyExpired);
    }

    Ok(())
}

fn validate_payment(
    env: &Env,
    agent: &Address,
    seller: &Address,
    asset: &Address,
    amount: i128,
    resource_hash: &BytesN<32>,
) -> Result<(), PolicyWalletError> {
    let policy = read_policy(env, agent)?;

    if env.ledger().sequence() > policy.valid_until_ledger {
        return Err(PolicyWalletError::PolicyExpired);
    }
    if amount <= 0 {
        return Err(PolicyWalletError::InvalidAmount);
    }
    if amount > policy.max_amount_per_payment {
        return Err(PolicyWalletError::AmountExceedsPaymentCap);
    }
    if !policy.allowed_sellers.contains(seller) {
        return Err(PolicyWalletError::SellerNotAllowed);
    }
    if !policy.allowed_assets.contains(asset) {
        return Err(PolicyWalletError::AssetNotAllowed);
    }
    if !policy.allowed_resource_hashes.contains(resource_hash) {
        return Err(PolicyWalletError::ResourceHashNotAllowed);
    }

    let spent = read_daily_spend(env, agent, current_ledger_day(env));
    let next_spent = spent
        .checked_add(amount)
        .ok_or(PolicyWalletError::AmountExceedsDailyCap)?;
    if next_spent > policy.max_amount_per_day {
        return Err(PolicyWalletError::AmountExceedsDailyCap);
    }

    Ok(())
}

fn read_daily_spend(env: &Env, agent: &Address, ledger_day: u32) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::DailySpend(agent.clone(), ledger_day))
        .unwrap_or(0)
}

fn current_ledger_day(env: &Env) -> u32 {
    env.ledger().sequence() / LEDGERS_PER_DAY
}

#[cfg(test)]
mod test;
