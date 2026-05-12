// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

/// @title IERC165
/// @author Somnia Foundation
/// @notice ERC-165 interface detection standard interface.
interface IERC165 {
    /// @notice Returns true if this contract implements the interface defined by `interfaceId`.
    /// @param interfaceId Interface identifier, as specified in ERC-165.
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}