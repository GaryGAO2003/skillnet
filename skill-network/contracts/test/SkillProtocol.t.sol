// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SkillNFT.sol";
import "../src/CompositionDAG.sol";
import "../src/FeeRouter.sol";

contract SkillProtocolTest is Test {
    SkillNFT public skillNFT;
    CompositionDAG public dag;
    FeeRouter public feeRouter;

    address public alice  = makeAddr("alice");
    address public bob    = makeAddr("bob");
    address public carol  = makeAddr("carol");
    address public dave   = makeAddr("dave");
    address public treasury = makeAddr("treasury");

    bytes32 constant CONTENT_HASH = keccak256("test-content");
    string  constant SCHEMA_URI   = "ipfs://QmTest";

    function setUp() public {
        skillNFT   = new SkillNFT();
        dag        = new CompositionDAG(address(skillNFT));
        feeRouter  = new FeeRouter(address(skillNFT), address(dag), treasury);

        skillNFT.setFeeRouter(address(feeRouter));

        // Fund test accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob,   10 ether);
        vm.deal(carol, 10 ether);
        vm.deal(dave,  10 ether);
    }

    // -------------------------------------------------------------------------
    // Helper
    // -------------------------------------------------------------------------

    function _mintSkill(
        address creator,
        string memory name,
        SkillNFT.SkillType skillType,
        SkillNFT.VisibilityTier tier,
        uint256 price
    ) internal returns (uint256 tokenId) {
        vm.prank(creator);
        tokenId = skillNFT.mintSkill(name, "desc", skillType, tier, CONTENT_HASH, SCHEMA_URI, price, 0);
    }

    /// @dev compose `child` from a single parent at weight 100
    function _compose1(address owner, uint256 child, uint256 parent, uint256 weight) internal {
        uint256[] memory p = new uint256[](1);
        uint256[] memory w = new uint256[](1);
        p[0] = parent; w[0] = weight;
        vm.prank(owner);
        dag.compose(child, p, w);
    }

    /// @dev compose `child` from two parents
    function _compose2(address owner, uint256 child, uint256 p0, uint256 p1, uint256 w0, uint256 w1) internal {
        uint256[] memory p = new uint256[](2);
        uint256[] memory w = new uint256[](2);
        p[0] = p0; p[1] = p1; w[0] = w0; w[1] = w1;
        vm.prank(owner);
        dag.compose(child, p, w);
    }

    // -------------------------------------------------------------------------
    // Test 1: Mint skill
    // -------------------------------------------------------------------------

    function testMintSkill() public {
        uint256 id = _mintSkill(alice, "JSON Parser", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);

        assertEq(id, 1);
        assertEq(skillNFT.totalSkills(), 1);
        assertEq(skillNFT.ownerOf(id), alice);

        SkillNFT.SkillMetadata memory m = skillNFT.getSkill(id);
        assertEq(m.name, "JSON Parser");
        assertEq(m.creator, alice);
        assertEq(uint8(m.tier), uint8(SkillNFT.VisibilityTier.OPEN));
        assertEq(uint8(m.skillType), uint8(SkillNFT.SkillType.TOOL_ADAPTER));
        assertEq(m.totalCalls, 0);
        assertEq(m.totalRevenue, 0);
        assertTrue(m.createdAt > 0);
    }

    // -------------------------------------------------------------------------
    // Test 2: Tier upgrade (one-way only)
    // -------------------------------------------------------------------------

    function testTierUpgradeOnly() public {
        uint256 id = _mintSkill(alice, "Private Skill", SkillNFT.SkillType.PROMPT_WORKFLOW, SkillNFT.VisibilityTier.PRIVATE, 0);

        // Upgrade PRIVATE → OPEN should succeed
        vm.prank(alice);
        skillNFT.upgradeTier(id, SkillNFT.VisibilityTier.OPEN);
        assertEq(uint8(skillNFT.getSkill(id).tier), uint8(SkillNFT.VisibilityTier.OPEN));

        // Downgrade OPEN → PRIVATE should revert
        vm.prank(alice);
        vm.expectRevert("SkillNFT: can only upgrade to more public tier");
        skillNFT.upgradeTier(id, SkillNFT.VisibilityTier.PRIVATE);

        // Upgrade to same tier should also revert
        vm.prank(alice);
        vm.expectRevert("SkillNFT: can only upgrade to more public tier");
        skillNFT.upgradeTier(id, SkillNFT.VisibilityTier.OPEN);
    }

    // -------------------------------------------------------------------------
    // Test 3: Compose skill
    // -------------------------------------------------------------------------

    function testComposeSkill() public {
        uint256 aId = _mintSkill(alice, "Skill A", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 bId = _mintSkill(alice, "Skill B", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 cId = _mintSkill(alice, "Skill C", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);

        uint256[] memory parents  = new uint256[](2);
        uint256[] memory weights  = new uint256[](2);
        parents[0] = aId; parents[1] = bId;
        weights[0] = 60;  weights[1] = 40;

        vm.prank(alice);
        dag.compose(cId, parents, weights);

        assertTrue(dag.isComposed(cId));
        assertEq(dag.depth(cId), 1);

        CompositionDAG.CompositionEdge[] memory deps = dag.getDependencies(cId);
        assertEq(deps.length, 2);
        assertEq(deps[0].parentSkillId, aId);
        assertEq(deps[0].weight, 60);
        assertEq(deps[1].parentSkillId, bId);
        assertEq(deps[1].weight, 40);

        // aId and bId should list cId as a dependent
        uint256[] memory depsOfA = dag.getDependents(aId);
        assertEq(depsOfA[0], cId);
    }

    // -------------------------------------------------------------------------
    // Test 4: Circular dependency blocked
    // -------------------------------------------------------------------------

    function testCircularDependencyBlocked() public {
        uint256 xId = _mintSkill(alice, "Skill X", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 yId = _mintSkill(alice, "Skill Y", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);

        // Compose Y = X
        uint256[] memory parents1 = new uint256[](1);
        uint256[] memory weights1 = new uint256[](1);
        parents1[0] = xId; weights1[0] = 100;
        vm.prank(alice);
        dag.compose(yId, parents1, weights1);

        // Now try to compose X = Y (creates cycle X → Y → X)
        uint256[] memory parents2 = new uint256[](1);
        uint256[] memory weights2 = new uint256[](1);
        parents2[0] = yId; weights2[0] = 100;
        vm.prank(alice);
        vm.expectRevert("CompositionDAG: would create cycle");
        dag.compose(xId, parents2, weights2);
    }

    // -------------------------------------------------------------------------
    // Test 5: Max depth enforced
    // -------------------------------------------------------------------------

    function testMaxDepthEnforced() public {
        // Build chain: s1 ← s2 ← s3 ← s4 ← s5 (depth 4) ← s6 (depth 5, should pass)
        // Then s7 ← s6 would be depth 6, should revert

        uint256 prev = _mintSkill(alice, "D0", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);

        for (uint256 i = 1; i <= 5; i++) {
            uint256 next = _mintSkill(alice, string(abi.encodePacked("D", vm.toString(i))), SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
            uint256[] memory p = new uint256[](1);
            uint256[] memory w = new uint256[](1);
            p[0] = prev; w[0] = 100;
            vm.prank(alice);
            dag.compose(next, p, w);
            prev = next;
        }

        // prev is now depth 5. Trying to add a child would be depth 6 — must revert
        uint256 tooDeep = _mintSkill(alice, "TooDeep", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        uint256[] memory p = new uint256[](1);
        uint256[] memory w = new uint256[](1);
        p[0] = prev; w[0] = 100;
        vm.prank(alice);
        vm.expectRevert("CompositionDAG: max depth exceeded");
        dag.compose(tooDeep, p, w);
    }

    // -------------------------------------------------------------------------
    // Test 6: Fee distribution (simple, single creator)
    // -------------------------------------------------------------------------

    function testFeeDistribution() public {
        // Alice mints a leaf skill; bob pays 1 ETH to call it
        uint256 id = _mintSkill(alice, "Leaf Skill", SkillNFT.SkillType.PROMPT_WORKFLOW, SkillNFT.VisibilityTier.OPEN, 1 ether);

        vm.prank(bob);
        feeRouter.payForCall{value: 1 ether}(id);

        // Alice should have 70% of 1 ETH = 0.7 ETH (no upstream; no upstream spent)
        // Plus unspent upstream (0.2 ETH) since no parents → creator gets remainder
        // Total: 0.7 + 0.2 = 0.9 ETH
        assertEq(feeRouter.getBalance(alice), 0.9 ether);
        assertEq(feeRouter.getBalance(treasury), 0.1 ether);
    }

    // -------------------------------------------------------------------------
    // Test 7: Recursive royalties (conserving rho-flow model, RHO = 20%)
    // -------------------------------------------------------------------------

    function testRecursiveRoyalties() public {
        // Setup: alice mints A (leaf), bob mints B (leaf)
        //        carol mints C with parents A(50%) and B(50%)
        //        dave pays 1 ETH to call C

        uint256 aId = _mintSkill(alice, "Skill A", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 bId = _mintSkill(bob,   "Skill B", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 cId = _mintSkill(carol, "Skill C", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 1 ether);

        uint256[] memory parents = new uint256[](2);
        uint256[] memory weights = new uint256[](2);
        parents[0] = aId; parents[1] = bId;
        weights[0] = 50;  weights[1] = 50;
        vm.prank(carol);
        dag.compose(cId, parents, weights);

        vm.prank(dave);
        feeRouter.payForCall{value: 1 ether}(cId);

        // Math (payment = 1 ETH), rho-flow: protocol 10% off the top, net = 0.9 ETH flows into C.
        //   Protocol:           0.1 ETH → treasury
        //   passUp = net * RHO = 0.9 * 20% = 0.18 ETH, split by weight 50/50:
        //     Alice gets: 0.18 * 50% = 0.09 ETH
        //     Bob   gets: 0.18 * 50% = 0.09 ETH
        //   Carol keeps net - passUp = 0.9 - 0.18 = 0.72 ETH
        assertEq(feeRouter.getBalance(treasury), 0.1 ether);
        assertEq(feeRouter.getBalance(alice),    0.09 ether);
        assertEq(feeRouter.getBalance(bob),      0.09 ether);
        assertEq(feeRouter.getBalance(carol),    0.72 ether);

        // Invariant: all balances sum to payment
        assertEq(
            feeRouter.getBalance(treasury) + feeRouter.getBalance(alice) +
            feeRouter.getBalance(bob) + feeRouter.getBalance(carol),
            1 ether
        );
    }

    // -------------------------------------------------------------------------
    // Test 7b: Bundle-of-bundles — the case the OLD depth-band model over-distributed
    //          (>100% of the upstream pool) and reverted on-chain. Must now conserve.
    // -------------------------------------------------------------------------

    function testBundleOfBundlesConservesAndDoesNotRevert() public {
        // Minimal trigger for the old bug: z = compose(m, n) where m AND n are themselves
        // composites at the same depth. The old depth-band model distributed
        // 0.50U (depth1: m,n) + 0.30U (depth2 via m) + 0.30U (depth2 via n) = 1.10U > U,
        // underflowing `upstreamTotal - upstreamDistributed` and reverting (panic 0x11).
        uint256 z;
        {
            uint256 a = _mintSkill(alice, "a", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
            uint256 b = _mintSkill(bob,   "b", SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
            uint256 m = _mintSkill(carol, "m", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
            uint256 n = _mintSkill(dave,  "n", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
            _compose1(carol, m, a, 100);
            _compose1(dave,  n, b, 100);
            z = _mintSkill(alice, "z", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 1 ether);
            _compose2(alice, z, m, n, 50, 50);
        }

        address payer = makeAddr("payer");
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        feeRouter.payForCall{value: 1 ether}(z); // OLD contract: reverts (panic 0x11). NEW: succeeds.

        assertEq(feeRouter.getBalance(treasury), 0.1 ether);
        // Conservation: every wei is accounted for across treasury + all creators (alice/bob/carol/dave).
        uint256 sum = feeRouter.getBalance(treasury)
            + feeRouter.getBalance(alice) + feeRouter.getBalance(bob)
            + feeRouter.getBalance(carol) + feeRouter.getBalance(dave);
        assertEq(sum, 1 ether);
    }

    // -------------------------------------------------------------------------
    // Test 7c: Diamond DAG — a shared ancestor reached via two paths. Must conserve.
    // -------------------------------------------------------------------------

    function testDiamondConserves() public {
        // base ← left, base ← right, top ← {left, right}; base is paid via both paths.
        uint256 base  = _mintSkill(alice, "base",  SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 left  = _mintSkill(bob,   "left",  SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 right = _mintSkill(carol, "right", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 top   = _mintSkill(dave,  "top",   SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);

        _compose1(bob,   left,  base, 100);
        _compose1(carol, right, base, 100);
        _compose2(dave,  top,   left, right, 50, 50);

        address payer = makeAddr("payer");
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        feeRouter.payForCall{value: 1 ether}(top);

        uint256 sum = feeRouter.getBalance(treasury)
            + feeRouter.getBalance(alice) + feeRouter.getBalance(bob)
            + feeRouter.getBalance(carol) + feeRouter.getBalance(dave);
        assertEq(sum, 1 ether);
        assertEq(feeRouter.getBalance(treasury), 0.1 ether);
    }

    // -------------------------------------------------------------------------
    // Test 7d: Fuzz — conservation holds for any payment amount on the diamond.
    // -------------------------------------------------------------------------

    function testFuzz_ConservationDiamond(uint96 rawPayment) public {
        uint256 payment = bound(uint256(rawPayment), 1, 100 ether);

        uint256 base  = _mintSkill(alice, "base",  SkillNFT.SkillType.TOOL_ADAPTER, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 left  = _mintSkill(bob,   "left",  SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 right = _mintSkill(carol, "right", SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        uint256 top   = _mintSkill(dave,  "top",   SkillNFT.SkillType.COMPOSITE_BUNDLE, SkillNFT.VisibilityTier.OPEN, 0);
        _compose1(bob,   left,  base, 100);
        _compose1(carol, right, base, 100);
        _compose2(dave,  top,   left, right, 50, 50);

        address payer = makeAddr("payer");
        vm.deal(payer, payment);
        vm.prank(payer);
        feeRouter.payForCall{value: payment}(top);

        uint256 sum = feeRouter.getBalance(treasury)
            + feeRouter.getBalance(alice) + feeRouter.getBalance(bob)
            + feeRouter.getBalance(carol) + feeRouter.getBalance(dave);
        assertEq(sum, payment); // never over- or under-distributes, for any amount
    }

    // -------------------------------------------------------------------------
    // Test 8: Withdraw
    // -------------------------------------------------------------------------

    function testWithdraw() public {
        uint256 id = _mintSkill(alice, "Paid Skill", SkillNFT.SkillType.PROMPT_WORKFLOW, SkillNFT.VisibilityTier.OPEN, 1 ether);

        vm.prank(bob);
        feeRouter.payForCall{value: 1 ether}(id);

        uint256 claimable = feeRouter.getBalance(alice);
        assertTrue(claimable > 0);

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        feeRouter.withdraw();

        assertEq(feeRouter.getBalance(alice), 0);
        assertEq(alice.balance, aliceBefore + claimable);
    }
}
