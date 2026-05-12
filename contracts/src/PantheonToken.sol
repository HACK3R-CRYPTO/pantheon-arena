// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice PHN — the resource token gods earn by winning battles and lose by challenging
contract PantheonToken {
    string public constant name = "Pantheon Token";
    string public constant symbol = "PHN";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public arena;
    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterSet(address indexed minter);

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyArena() {
        if (msg.sender != arena) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setArena(address _arena) external onlyOwner {
        arena = _arena;
        emit MinterSet(_arena);
    }

    /// @notice Called by Arena to seed initial god treasuries
    function mintTo(address to, uint256 amount) external onlyArena {
        _mint(to, amount);
    }

    /// @notice Called by Arena to reward match winners
    function reward(address winner, address loser, uint256 stake) external onlyArena {
        // Burn from loser, mint to winner (net-zero supply but redistributes)
        _burn(loser, stake);
        _mint(winner, stake);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        totalSupply -= amount;
        balanceOf[from] -= amount;
        emit Transfer(from, address(0), amount);
    }
}
