// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SettlementVault.sol";

contract SettlementVaultTest is Test {
    SettlementVault public vault;

    address public treasury = makeAddr("treasury");
    address public alice;
    uint256 public alicePk;
    address public bob;
    uint256 public bobPk;

    function setUp() public {
        // The test contract itself acts as the gateway (submitter of batches).
        vault = new SettlementVault(address(this));
        (alice, alicePk) = makeAddrAndKey("alice");
        (bob, bobPk)     = makeAddrAndKey("bob");
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        vault.deposit{value: amount}();
    }

    function _sign(uint256 pk, address payer, uint256 cumulative) internal view returns (bytes memory) {
        SettlementVault.Voucher memory v = SettlementVault.Voucher({ payer: payer, cumulativeSpent: cumulative });
        bytes32 digest = vault.hashVoucher(v);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, vv);
    }

    function _voucher(address payer, uint256 cumulative) internal pure returns (SettlementVault.Voucher memory) {
        return SettlementVault.Voucher({ payer: payer, cumulativeSpent: cumulative });
    }

    // -------------------------------------------------------------------------
    // Happy path: one payer, split across recipients + treasury
    // -------------------------------------------------------------------------

    function testSettleSingleVoucher() public {
        _deposit(alice, 1 ether);

        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);
        sigs[0]     = _sign(alicePk, alice, 0.5 ether);

        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](2);
        credits[0] = SettlementVault.Credit({ recipient: bob,      amount: 0.45 ether });
        credits[1] = SettlementVault.Credit({ recipient: treasury, amount: 0.05 ether });

        vault.settleBatch(vouchers, sigs, credits);

        assertEq(vault.deposits(alice), 0.5 ether);   // 1.0 - 0.5 spent
        assertEq(vault.spent(alice),    0.5 ether);
        assertEq(vault.balances(bob),      0.45 ether);
        assertEq(vault.balances(treasury), 0.05 ether);

        // Vault ETH is fully accounted for: remaining deposit + credited balances == deposited
        assertEq(address(vault).balance, vault.deposits(alice) + vault.balances(bob) + vault.balances(treasury));
        assertEq(address(vault).balance, 1 ether);
    }

    // -------------------------------------------------------------------------
    // Many recipients credited in ONE tx (no per-recipient account / rent)
    // -------------------------------------------------------------------------

    function testManyRecipientsInOneBatch() public {
        _deposit(alice, 10 ether);

        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 10 ether);
        sigs[0]     = _sign(alicePk, alice, 10 ether);

        uint256 n = 100;
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](n);
        for (uint256 i = 0; i < n; i++) {
            credits[i] = SettlementVault.Credit({ recipient: vm.addr(1000 + i), amount: 0.1 ether });
        }

        vault.settleBatch(vouchers, sigs, credits); // 100 recipients, single transaction

        for (uint256 i = 0; i < n; i++) {
            assertEq(vault.balances(vm.addr(1000 + i)), 0.1 ether);
        }
        assertEq(vault.deposits(alice), 0); // all 10 ether settled
        assertEq(address(vault).balance, 10 ether);
    }

    // -------------------------------------------------------------------------
    // Cumulative vouchers across batches (state-channel style): only the delta is debited
    // -------------------------------------------------------------------------

    function testCumulativeAcrossBatches() public {
        _deposit(alice, 5 ether);

        // Batch 1: cumulative 2 ether
        _settleOne(alice, alicePk, 2 ether, bob, 2 ether);
        assertEq(vault.spent(alice), 2 ether);
        assertEq(vault.balances(bob), 2 ether);

        // Batch 2: cumulative 3 ether -> debits only the 1 ether delta
        _settleOne(alice, alicePk, 3 ether, bob, 1 ether);
        assertEq(vault.spent(alice), 3 ether);
        assertEq(vault.balances(bob), 3 ether);
        assertEq(vault.deposits(alice), 2 ether); // 5 - 3
    }

    /// @dev settle a single payer->single recipient batch with the given delta credited
    function _settleOne(address payer, uint256 pk, uint256 cumulative, address to, uint256 credit) internal {
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(payer, cumulative);
        sigs[0]     = _sign(pk, payer, cumulative);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: to, amount: credit });
        vault.settleBatch(vouchers, sigs, credits);
    }

    // -------------------------------------------------------------------------
    // Rejections
    // -------------------------------------------------------------------------

    function testRejectReplay() public {
        _deposit(alice, 1 ether);
        _settleOne(alice, alicePk, 0.5 ether, bob, 0.5 ether);
        // replay the same cumulative voucher -> stale
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);
        sigs[0]     = _sign(alicePk, alice, 0.5 ether);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: bob, amount: 0.5 ether });
        vm.expectRevert("SettlementVault: stale voucher");
        vault.settleBatch(vouchers, sigs, credits);
    }

    function testRejectOverspend() public {
        _deposit(alice, 0.3 ether);
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);  // signs more than deposited
        sigs[0]     = _sign(alicePk, alice, 0.5 ether);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: bob, amount: 0.5 ether });
        vm.expectRevert("SettlementVault: insufficient deposit");
        vault.settleBatch(vouchers, sigs, credits);
    }

    function testRejectBadSignature() public {
        _deposit(alice, 1 ether);
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);
        sigs[0]     = _sign(bobPk, alice, 0.5 ether);  // bob signs alice's voucher
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: bob, amount: 0.5 ether });
        vm.expectRevert("SettlementVault: bad signature");
        vault.settleBatch(vouchers, sigs, credits);
    }

    function testRejectNonConserving() public {
        _deposit(alice, 1 ether);
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);
        sigs[0]     = _sign(alicePk, alice, 0.5 ether);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: bob, amount: 0.6 ether }); // credits > debited
        vm.expectRevert("SettlementVault: not conserved");
        vault.settleBatch(vouchers, sigs, credits);
    }

    function testOnlyGateway() public {
        _deposit(alice, 1 ether);
        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, 0.5 ether);
        sigs[0]     = _sign(alicePk, alice, 0.5 ether);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](1);
        credits[0] = SettlementVault.Credit({ recipient: bob, amount: 0.5 ether });
        vm.prank(makeAddr("stranger"));
        vm.expectRevert("SettlementVault: not gateway");
        vault.settleBatch(vouchers, sigs, credits);
    }

    // -------------------------------------------------------------------------
    // Withdraw (pull pattern)
    // -------------------------------------------------------------------------

    function testWithdraw() public {
        _deposit(alice, 1 ether);
        _settleOne(alice, alicePk, 0.5 ether, bob, 0.5 ether);

        uint256 before = bob.balance;
        vm.prank(bob);
        vault.withdraw();
        assertEq(vault.balances(bob), 0);
        assertEq(bob.balance, before + 0.5 ether);
    }

    // -------------------------------------------------------------------------
    // Fuzz: conservation holds across an arbitrary cumulative + split
    // -------------------------------------------------------------------------

    function testFuzz_Conservation(uint96 rawDeposit, uint96 rawCumulative, uint96 rawSplit) public {
        uint256 dep = bound(uint256(rawDeposit), 2, 100 ether);
        uint256 cum = bound(uint256(rawCumulative), 1, dep);
        uint256 toBob = bound(uint256(rawSplit), 0, cum);
        uint256 toTreasury = cum - toBob;

        _deposit(alice, dep);

        SettlementVault.Voucher[] memory vouchers = new SettlementVault.Voucher[](1);
        bytes[] memory sigs = new bytes[](1);
        vouchers[0] = _voucher(alice, cum);
        sigs[0]     = _sign(alicePk, alice, cum);
        SettlementVault.Credit[] memory credits = new SettlementVault.Credit[](2);
        credits[0] = SettlementVault.Credit({ recipient: bob,      amount: toBob });
        credits[1] = SettlementVault.Credit({ recipient: treasury, amount: toTreasury });

        vault.settleBatch(vouchers, sigs, credits);

        // Every wei deposited is either still on deposit or credited out — nothing created or destroyed.
        assertEq(address(vault).balance, dep);
        assertEq(vault.deposits(alice) + vault.balances(bob) + vault.balances(treasury), dep);
    }
}
