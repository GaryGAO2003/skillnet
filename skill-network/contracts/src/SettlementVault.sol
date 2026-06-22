// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}  from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title SettlementVault
/// @notice Off-chain-accrual / on-chain-batch settlement for SkillNet skill-call micropayments.
/// @dev Research (research/onchain-micropayments/report.md) shows per-call on-chain settlement of
///      sub-cent, multi-recipient DAG royalties is uneconomic on every chain (fee floor 2.5-3.7x a
///      $0.0003 call; per-recipient token-account rent ~1000x; no microsecond finality). So:
///
///        per call (OFF-CHAIN): the gateway runs the conserving rho-flow (see FeeRouter._royalty)
///          to accrue per-recipient balances, and the payer signs a CUMULATIVE-spend voucher.
///        on settle (ON-CHAIN, batched): the gateway submits the latest voucher per payer + a netted
///          credit list. The contract debits each payer's prepaid deposit up to their SIGNED cumulative
///          amount and credits recipients into an INTERNAL LEDGER (a balances mapping — no per-recipient
///          token account, no rent), so one tx pays hundreds of recipients. Recipients withdraw lazily.
///
///      TRUST MODEL (honest):
///        - A payer can never be debited beyond what they cryptographically signed (EIP-712 voucher) or
///          beyond their deposit. Worst case for a payer is a liveness delay, not theft.
///        - The gateway is trusted to compute the rho-flow split correctly (which recipient gets what).
///          On-chain we enforce conservation (sum(credits) == sum(debits)) but not the split itself.
///          Production hardening: commit a Merkle root of (recipient, cumulativeOwed) per batch and let
///          recipients claim against it with a proof, removing gateway trust over allocation. (TODO)
contract SettlementVault is EIP712 {
    using ECDSA for bytes32;

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice A payer's signed authorization of TOTAL (cumulative) spend to date.
    struct Voucher {
        address payer;
        uint256 cumulativeSpent;
    }

    /// @notice One recipient credit in a settlement batch (already netted off-chain).
    struct Credit {
        address recipient;
        uint256 amount;
    }

    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address payer,uint256 cumulativeSpent)");

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The operator authorized to submit settlement batches.
    address public immutable gateway;

    /// @notice Prepaid balance a payer has deposited and not yet spent.
    mapping(address => uint256) public deposits;

    /// @notice Cumulative amount already settled for a payer (monotonic; replay guard).
    mapping(address => uint256) public spent;

    /// @notice Claimable balance per recipient (internal ledger — no per-recipient token account).
    mapping(address => uint256) public balances;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Deposited(address indexed payer, uint256 amount, uint256 newDeposit);
    event VoucherConsumed(address indexed payer, uint256 delta, uint256 cumulativeSpent);
    event BatchSettled(uint256 totalDebited, uint256 numVouchers, uint256 numCredits);
    event Withdrawn(address indexed recipient, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _gateway) EIP712("SkillNetSettlement", "1") {
        require(_gateway != address(0), "SettlementVault: zero gateway");
        gateway = _gateway;
    }

    modifier onlyGateway() {
        require(msg.sender == gateway, "SettlementVault: not gateway");
        _;
    }

    // -------------------------------------------------------------------------
    // Payer: deposit
    // -------------------------------------------------------------------------

    /// @notice Prepay into the vault. Off-chain calls draw against this via signed vouchers.
    function deposit() external payable {
        require(msg.value > 0, "SettlementVault: zero deposit");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    // -------------------------------------------------------------------------
    // EIP-712 voucher hashing (exposed so off-chain signers / tests can reproduce it)
    // -------------------------------------------------------------------------

    function hashVoucher(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, v.payer, v.cumulativeSpent))
        );
    }

    // -------------------------------------------------------------------------
    // Gateway: batch settlement
    // -------------------------------------------------------------------------

    /// @notice Settle a batch: debit each payer up to their signed cumulative spend, credit recipients.
    /// @dev Conserving by enforcement: total credited MUST equal total debited (the protocol fee is just
    ///      another Credit to the treasury address). Reverts on bad signature, stale/over-spent voucher,
    ///      or non-conserving credit list.
    function settleBatch(
        Voucher[] calldata vouchers,
        bytes[]   calldata sigs,
        Credit[]  calldata credits
    ) external onlyGateway {
        require(vouchers.length == sigs.length, "SettlementVault: length mismatch");

        uint256 debited;
        for (uint256 i = 0; i < vouchers.length; i++) {
            Voucher calldata v = vouchers[i];
            address signer = hashVoucher(v).recover(sigs[i]);
            require(signer == v.payer, "SettlementVault: bad signature");
            require(v.cumulativeSpent > spent[v.payer], "SettlementVault: stale voucher");

            uint256 delta = v.cumulativeSpent - spent[v.payer];
            require(deposits[v.payer] >= delta, "SettlementVault: insufficient deposit");

            deposits[v.payer] -= delta;
            spent[v.payer] = v.cumulativeSpent;
            debited += delta;
            emit VoucherConsumed(v.payer, delta, v.cumulativeSpent);
        }

        uint256 credited;
        for (uint256 j = 0; j < credits.length; j++) {
            balances[credits[j].recipient] += credits[j].amount;
            credited += credits[j].amount;
        }

        require(credited == debited, "SettlementVault: not conserved");
        emit BatchSettled(debited, vouchers.length, credits.length);
    }

    // -------------------------------------------------------------------------
    // Recipient: withdraw (pull pattern)
    // -------------------------------------------------------------------------

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "SettlementVault: nothing to withdraw");
        balances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "SettlementVault: transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getDeposit(address a) external view returns (uint256) { return deposits[a]; }
    function getBalance(address a) external view returns (uint256) { return balances[a]; }
}
