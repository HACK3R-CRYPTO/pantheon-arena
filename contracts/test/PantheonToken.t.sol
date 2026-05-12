// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PantheonToken} from "../src/PantheonToken.sol";

contract PantheonTokenTest is Test {
    PantheonToken public token;

    address public owner;
    address public arenaAddr;
    address public alice;
    address public bob;
    address public stranger;

    function setUp() public {
        owner = address(this);
        arenaAddr = vm.addr(10);
        alice = vm.addr(1);
        bob = vm.addr(2);
        stranger = vm.addr(3);

        token = new PantheonToken();
        token.setArena(arenaAddr);
    }

    // ── ERC-20 basics ──────────────────────────────────────────────────────────

    function test_metadata() public view {
        assertEq(token.name(), "Pantheon Token");
        assertEq(token.symbol(), "PHN");
        assertEq(token.decimals(), 18);
    }

    function test_initialSupplyIsZero() public view {
        assertEq(token.totalSupply(), 0);
    }

    function test_transfer() public {
        token.mintTo(alice, 1000 ether);
        vm.prank(alice);
        token.transfer(bob, 400 ether);
        assertEq(token.balanceOf(alice), 600 ether);
        assertEq(token.balanceOf(bob), 400 ether);
    }

    function test_transfer_revertsOnInsufficientBalance() public {
        token.mintTo(alice, 100 ether);
        vm.prank(alice);
        vm.expectRevert(PantheonToken.InsufficientBalance.selector);
        token.transfer(bob, 200 ether);
    }

    function test_approve_and_transferFrom() public {
        token.mintTo(alice, 500 ether);
        vm.prank(alice);
        token.approve(bob, 300 ether);
        assertEq(token.allowance(alice, bob), 300 ether);

        vm.prank(bob);
        token.transferFrom(alice, bob, 200 ether);
        assertEq(token.balanceOf(bob), 200 ether);
        assertEq(token.allowance(alice, bob), 100 ether);
    }

    function test_transferFrom_revertsOnInsufficientAllowance() public {
        token.mintTo(alice, 500 ether);
        vm.prank(alice);
        token.approve(bob, 50 ether);

        vm.prank(bob);
        vm.expectRevert(PantheonToken.InsufficientAllowance.selector);
        token.transferFrom(alice, bob, 100 ether);
    }

    function test_transferFrom_maxAllowanceNoDecrease() public {
        token.mintTo(alice, 500 ether);
        vm.prank(alice);
        token.approve(bob, type(uint256).max);

        vm.prank(bob);
        token.transferFrom(alice, bob, 300 ether);
        // Allowance stays at max
        assertEq(token.allowance(alice, bob), type(uint256).max);
    }

    // ── setArena (onlyOwner) ───────────────────────────────────────────────────

    function test_setArena_byOwner() public {
        address newArena = vm.addr(99);
        vm.expectEmit(true, false, false, false);
        emit PantheonToken.MinterSet(newArena);
        token.setArena(newArena);
        assertEq(token.arena(), newArena);
    }

    function test_setArena_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(PantheonToken.Unauthorized.selector);
        token.setArena(vm.addr(99));
    }

    // ── mintTo ─────────────────────────────────────────────────────────────────

    function test_mintTo_byOwner() public {
        token.mintTo(alice, 1000 ether);
        assertEq(token.balanceOf(alice), 1000 ether);
        assertEq(token.totalSupply(), 1000 ether);
    }

    function test_mintTo_byArena() public {
        vm.prank(arenaAddr);
        token.mintTo(bob, 500 ether);
        assertEq(token.balanceOf(bob), 500 ether);
    }

    function test_mintTo_revertsForStranger() public {
        vm.prank(stranger);
        vm.expectRevert(PantheonToken.Unauthorized.selector);
        token.mintTo(alice, 1000 ether);
    }

    function test_mintTo_emitsTransferFromZero() public {
        vm.expectEmit(true, true, false, true);
        emit PantheonToken.Transfer(address(0), alice, 1000 ether);
        token.mintTo(alice, 1000 ether);
    }

    // ── reward (onlyArena) ─────────────────────────────────────────────────────

    function test_reward_transfersStake() public {
        // Give both gods some balance
        token.mintTo(alice, 1000 ether);
        token.mintTo(bob, 1000 ether);

        uint256 stake = 200 ether;
        vm.prank(arenaAddr);
        token.reward(alice, bob, stake);

        // Winner gains stake, loser loses stake; total supply unchanged
        assertEq(token.balanceOf(alice), 1200 ether);
        assertEq(token.balanceOf(bob), 800 ether);
        assertEq(token.totalSupply(), 2000 ether);
    }

    function test_reward_revertsForNonArena() public {
        token.mintTo(alice, 1000 ether);
        token.mintTo(bob, 1000 ether);

        vm.prank(stranger);
        vm.expectRevert(PantheonToken.Unauthorized.selector);
        token.reward(alice, bob, 100 ether);
    }

    function test_reward_revertsIfLoserLacksBalance() public {
        token.mintTo(alice, 1000 ether);
        // Bob has 0

        vm.prank(arenaAddr);
        vm.expectRevert(PantheonToken.InsufficientBalance.selector);
        token.reward(alice, bob, 100 ether);
    }

    function test_reward_byOwnerRevertsUnlessArena() public {
        token.mintTo(alice, 500 ether);
        token.mintTo(bob, 500 ether);
        // owner is NOT arena, so must revert
        vm.expectRevert(PantheonToken.Unauthorized.selector);
        token.reward(alice, bob, 100 ether);
    }
}
