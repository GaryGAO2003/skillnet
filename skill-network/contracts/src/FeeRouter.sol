// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SkillNFT.sol";
import "./CompositionDAG.sol";

/// @title FeeRouter
/// @notice Routes skill-call payments with recursive royalty distribution through the composition DAG.
/// @dev Uses a pull pattern: balances accumulate, creators call withdraw().
///
/// ROYALTY MODEL — conserving weight-proportional flow (single decay knob RHO):
///   protocol = value * PROTOCOL_SHARE        -> treasury
///   net      = value - protocol              -> flows into the DAG at the called skill
///   royalty(node, amount):
///     leaf node      -> creator[node] += amount                (keeps everything)
///     composite node -> passUp = amount * RHO; split passUp across parents by weight,
///                       recurse; creator[node] += amount - distributed   (keeps (1-RHO)*amount + dust)
///
/// This conserves value for ANY DAG shape — chains, diamonds, and bundles-of-bundles —
/// because every subtree disburses exactly its input (kept = amount - distributed, and
/// distributed <= passUp <= amount, so the subtraction never underflows). This replaces the
/// previous depth-band model [50/30/15/5]% which applied the band fraction once PER BRANCH and
/// over-distributed (>100% of the upstream pool) on any composite-of-composites, reverting on-chain.
contract FeeRouter {
    // -------------------------------------------------------------------------
    // Constants (basis points out of 10000) — governance-adjustable in production
    // -------------------------------------------------------------------------

    /// @notice Protocol fee taken off the top, before anything flows into the DAG. 10%.
    uint256 public constant PROTOCOL_SHARE = 1000; // 10%

    /// @notice Upstream pass-through fraction per composition hop. 20%.
    ///         At each composite node the creator keeps (1 - RHO) of what reaches it and passes
    ///         RHO upstream (split by edge weights). Depth-decay emerges naturally as RHO^depth.
    ///         A leaf creator keeps 100% of what reaches it. With PROTOCOL_SHARE=10% & RHO=20%,
    ///         a leaf call pays creator 90%; a one-level composition pays creator 72% / parents 18% / protocol 10%.
    uint256 public constant RHO = 2000; // 20%

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    SkillNFT public immutable skillNFT;
    CompositionDAG public immutable dag;
    address public immutable treasury;

    /// @notice Claimable balance per address (pull pattern)
    mapping(address => uint256) public balances;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event SkillPayment(uint256 indexed skillId, address indexed caller, uint256 amount);
    event RoyaltyDistributed(uint256 indexed skillId, address indexed recipient, uint256 amount);
    event ProtocolFee(uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _skillNFT, address _dag, address _treasury) {
        require(_skillNFT != address(0) && _dag != address(0) && _treasury != address(0), "FeeRouter: zero address");
        skillNFT = SkillNFT(_skillNFT);
        dag = CompositionDAG(_dag);
        treasury = _treasury;
    }

    // -------------------------------------------------------------------------
    // Write functions
    // -------------------------------------------------------------------------

    /// @notice Pay to call a skill — distributes fees to protocol, creator, and upstream DAG.
    /// @param skillId Token ID of the skill being called
    function payForCall(uint256 skillId) external payable {
        SkillNFT.SkillMetadata memory skill = skillNFT.getSkill(skillId);
        require(msg.value >= skill.pricePerCall, "FeeRouter: insufficient payment");

        // Record call in SkillNFT
        skillNFT.recordCall(skillId, msg.value);

        // Protocol fee off the top
        uint256 protocolAmount = (msg.value * PROTOCOL_SHARE) / 10000;
        balances[treasury] += protocolAmount;
        emit ProtocolFee(protocolAmount);

        // Remainder flows through the DAG, conserving exactly (no underflow, no over-distribution)
        uint256 net = msg.value - protocolAmount;
        _royalty(skillId, net);

        emit SkillPayment(skillId, msg.sender, msg.value);
    }

    /// @notice Withdraw accumulated balance
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "FeeRouter: nothing to withdraw");
        balances[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "FeeRouter: transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // Read functions
    // -------------------------------------------------------------------------

    /// @notice View claimable balance for an address
    function getBalance(address addr) external view returns (uint256) {
        return balances[addr];
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    /// @notice Distribute `amount` to `skillId`'s creator and recursively upstream through the DAG.
    /// @dev Conserving by construction: a leaf credits its creator the full `amount`; a composite
    ///      passes `passUp = amount * RHO / 10000` to its parents (split by weight, each share fully
    ///      distributed by recursion) and credits its own creator `amount - distributed`. Since
    ///      `distributed <= passUp <= amount`, the credit is always >= 0 and the subtree disburses
    ///      exactly `amount`. Bounded by CompositionDAG.MAX_DEPTH (5).
    /// @param skillId Current skill node
    /// @param amount  Amount flowing into this node
    function _royalty(uint256 skillId, uint256 amount) internal {
        address creator = skillNFT.getSkill(skillId).creator;
        CompositionDAG.CompositionEdge[] memory deps = dag.getDependencies(skillId);

        // Leaf node: keeps the whole amount
        if (deps.length == 0) {
            balances[creator] += amount;
            emit RoyaltyDistributed(skillId, creator, amount);
            return;
        }

        // Composite node: pass RHO upstream (by weight), keep the remainder
        uint256 passUp = (amount * RHO) / 10000;
        uint256 distributed = 0;
        for (uint256 i = 0; i < deps.length; i++) {
            // edge weights sum to 100 (enforced at compose time)
            uint256 share = (passUp * deps[i].weight) / 100;
            if (share > 0) {
                _royalty(deps[i].parentSkillId, share);
                distributed += share;
            }
        }

        uint256 kept = amount - distributed; // (1-RHO)*amount + rounding dust; never underflows
        balances[creator] += kept;
        emit RoyaltyDistributed(skillId, creator, kept);
    }
}
