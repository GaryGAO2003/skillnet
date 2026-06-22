// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SkillNFT.sol";

/// @title CompositionDAG
/// @notice Tracks dependency graphs (DAGs) between skills
/// @dev Enforces max depth 5, weight sum = 100, no cycles, no self-references
contract CompositionDAG {
    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct CompositionEdge {
        uint256 parentSkillId;
        uint256 weight; // 0-100, all weights for a child must sum to 100
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 public constant MAX_DEPTH = 5;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    SkillNFT public immutable skillNFT;

    /// @notice childId => list of parent edges
    mapping(uint256 => CompositionEdge[]) private _dependencies;

    /// @notice parentId => list of child IDs that depend on it
    mapping(uint256 => uint256[]) private _dependents;

    /// @notice skillId => depth in DAG (0 = leaf / unregistered)
    mapping(uint256 => uint256) public depth;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Composed(uint256 indexed childId, uint256[] parentIds, uint256[] weights);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _skillNFT) {
        require(_skillNFT != address(0), "CompositionDAG: zero address");
        skillNFT = SkillNFT(_skillNFT);
    }

    // -------------------------------------------------------------------------
    // Write functions
    // -------------------------------------------------------------------------

    /// @notice Register a composed skill's dependencies
    /// @param childId Token ID of the child (composed) skill
    /// @param parentIds Array of parent skill token IDs
    /// @param weights Array of weights (must sum to 100)
    function compose(
        uint256 childId,
        uint256[] calldata parentIds,
        uint256[] calldata weights
    ) external {
        require(skillNFT.ownerOf(childId) == msg.sender, "CompositionDAG: not skill owner");
        require(parentIds.length > 0, "CompositionDAG: no parents provided");
        require(parentIds.length == weights.length, "CompositionDAG: length mismatch");
        require(_dependencies[childId].length == 0, "CompositionDAG: already composed");

        // Validate weights sum to 100
        uint256 weightSum = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            weightSum += weights[i];
        }
        require(weightSum == 100, "CompositionDAG: weights must sum to 100");

        // Validate parents and detect cycles / duplicates
        uint256 maxParentDepth = 0;
        for (uint256 i = 0; i < parentIds.length; i++) {
            uint256 parentId = parentIds[i];
            require(parentId != childId, "CompositionDAG: self-reference");
            require(weights[i] > 0, "CompositionDAG: weight must be > 0");

            // Duplicate parent check: parentIds[i] must not already appear earlier in the array
            for (uint256 j = 0; j < i; j++) {
                require(parentIds[j] != parentId, "CompositionDAG: duplicate parent");
            }

            // Cycle detection: childId must not be an ancestor of parentId
            require(!_isAncestor(parentId, childId), "CompositionDAG: would create cycle");

            // Track max depth of parents
            if (depth[parentId] > maxParentDepth) {
                maxParentDepth = depth[parentId];
            }
        }

        // Enforce max depth
        uint256 childDepth = maxParentDepth + 1;
        require(childDepth <= MAX_DEPTH, "CompositionDAG: max depth exceeded");

        // Store edges
        for (uint256 i = 0; i < parentIds.length; i++) {
            _dependencies[childId].push(CompositionEdge({
                parentSkillId: parentIds[i],
                weight: weights[i]
            }));
            _dependents[parentIds[i]].push(childId);
        }

        depth[childId] = childDepth;

        emit Composed(childId, parentIds, weights);
    }

    // -------------------------------------------------------------------------
    // Read functions
    // -------------------------------------------------------------------------

    /// @notice Get all dependency edges for a skill
    function getDependencies(uint256 skillId) external view returns (CompositionEdge[] memory) {
        return _dependencies[skillId];
    }

    /// @notice Get all child skill IDs that depend on this skill
    function getDependents(uint256 skillId) external view returns (uint256[] memory) {
        return _dependents[skillId];
    }

    /// @notice Check if a skill has registered dependencies
    function isComposed(uint256 skillId) external view returns (bool) {
        return _dependencies[skillId].length > 0;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    /// @notice BFS cycle detection: returns true if `target` is an ancestor of `start`
    /// @dev Bounded queue of 100 nodes — sufficient for MAX_DEPTH = 5
    function _isAncestor(uint256 start, uint256 target) internal view returns (bool) {
        uint256[100] memory queue;
        uint256 head = 0;
        uint256 tail = 0;

        queue[tail++] = start;

        while (head < tail && tail <= 100) {
            uint256 current = queue[head++];

            CompositionEdge[] storage edges = _dependencies[current];
            for (uint256 i = 0; i < edges.length; i++) {
                uint256 parentId = edges[i].parentSkillId;
                if (parentId == target) return true;
                if (tail < 100) {
                    queue[tail++] = parentId;
                }
            }
        }

        return false;
    }
}
