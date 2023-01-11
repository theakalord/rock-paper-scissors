// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";

/// @title Rock-Paper-Scissors Game Contract
contract RPS is Ownable, VRFConsumerBase {
    enum Action {
        Rock,
        Paper,
        Scissors
    }

    enum Result {
        Win,
        Lose,
        Draw
    }

    /// @notice Game struct
    /// @param player Player address
    /// @param action Player's action. One of Rock, Paper or Scissors
    /// @param bet Bet amount
    struct Game {
        address player;
        Action action;
        uint256 bet;
    }

    /// @notice Game infos
    mapping(bytes32 => Game) public games;

    /// @notice Claimable reward amount per user
    mapping(address => uint256) public claimable;

    /// @dev VRF key hash
    bytes32 internal vrfKeyHash;

    /// @dev VRF fee amount
    uint256 internal vrfFee;

    /**********/
    /* Events */
    /**********/

    /// @notice Emitted when player places bet and submit action
    /// @param player Player address
    /// @param action Player's action
    /// @param bet Bet amount
    event Submitted(address indexed player, Action action, uint256 bet);

    /// @notice Emitted when the game is ended
    /// @param gameId Game ID
    /// @param result Result of the game
    event GameEnded(bytes32 gameId, Result result);

    /// @notice Emitted when player claims reward
    /// @param amount Claim amount
    event Claimed(uint256 amount);

    /**********/
    /* Errors */
    /**********/

    /// @notice Invalid Amount
    error InvalidAmount();

    /// @notice Insufficient Claimable Amount
    /// @param amount Claim amount
    error InsufficientClaimable(uint256 amount);

    /// @notice Insufficient Balance
    error InsufficientBalance();

    /// @notice Insufficient Link Balance
    error InsufficientLink();

    /// @notice Claim Failed
    error ClaimFailed();

    /***************/
    /* Constructor */
    /***************/

    /// @notice Constructor
    /// @param _vrfCoordinator VRF Coordinator address
    /// @param _link LINK token address
    /// @param _vrfKeyHash VRF key hash
    /// @param _vrfFee VRF fee amount
    constructor(
        address _vrfCoordinator,
        address _link,
        bytes32 _vrfKeyHash,
        uint256 _vrfFee
    )
        VRFConsumerBase(
            _vrfCoordinator, // VRF Coordinator
            _link // LINK Token
        )
    {
        vrfKeyHash = _vrfKeyHash;
        vrfFee = _vrfFee;
    }

    /********************/
    /* Player Functions */
    /********************/

    /// @notice Place bet and submit action
    /// @param action Action
    /// @return gameId Game ID
    function submit(Action action) external payable returns (bytes32 gameId) {
        if (vrfFee > LINK.balanceOf(address(this))) {
            revert InsufficientLink();
        }

        gameId = requestRandomness(vrfKeyHash, vrfFee);
        games[gameId] = Game({
            player: msg.sender,
            action: action,
            bet: msg.value
        });

        emit Submitted(msg.sender, action, msg.value);
    }

    /// @notice Claim reward
    /// @param amount Claim amount
    function claim(uint256 amount) external {
        if (claimable[msg.sender] < amount) {
            revert InsufficientClaimable(amount);
        }
        if (address(this).balance < amount) {
            revert InsufficientBalance();
        }

        claimable[msg.sender] -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            revert ClaimFailed();
        }

        emit Claimed(amount);
    }

    /*******************/
    /* Owner Functions */
    /*******************/

    /// @notice Fund the game contract. Only owner can call this function.
    function fund() external payable onlyOwner {
        if (msg.value == 0) {
            revert InvalidAmount();
        }
    }

    /**********************/
    /* Internal Functions */
    /**********************/

    /// @notice Callback function used by VRF Coordinator
    /// @param gameId Game ID
    /// @param randomness Random number
    function fulfillRandomness(
        bytes32 gameId,
        uint256 randomness
    ) internal override {
        Game storage game = games[gameId];
        address player = game.player;
        Action opponentAction = Action(randomness % 3);
        Result result = getResult(game.action, opponentAction);

        uint256 reward;
        if (result == Result.Win) {
            reward = game.bet * 2;
        } else if (result == Result.Draw) {
            reward = game.bet;
        }

        // emits event
        emit GameEnded(gameId, result);

        if (reward > 0) {
            uint256 amountToPay = address(this).balance < reward
                ? address(this).balance
                : reward;

            if (amountToPay > 0) {
                (bool success, ) = payable(player).call{value: amountToPay}("");
                if (success) {
                    reward -= amountToPay;
                }
            }

            if (reward > 0) {
                // store remaining reward for player to claim
                claimable[player] += reward;
            }
        }
    }

    /// @dev Calculate result of the game
    /// @param player Player's action
    /// @param opponent Opponent's action
    /// @return result Result of the game
    function getResult(
        Action player,
        Action opponent
    ) internal pure returns (Result result) {
        if (player == opponent) {
            return Result.Draw;
        }
        if (opponent == Action((uint256(player) + 1) % 3)) {
            return Result.Lose;
        }
        return Result.Win;
    }
}
