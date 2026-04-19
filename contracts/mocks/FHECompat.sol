// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

type euint128 is uint256;
type ebool is bool;

library FHE {
    function asEuint128(uint256 value) internal pure returns (euint128) {
        return euint128.wrap(value);
    }

    function gt(euint128 lhs, euint128 rhs) internal pure returns (ebool) {
        return ebool.wrap(euint128.unwrap(lhs) > euint128.unwrap(rhs));
    }

    function lt(euint128 lhs, euint128 rhs) internal pure returns (ebool) {
        return ebool.wrap(euint128.unwrap(lhs) < euint128.unwrap(rhs));
    }

    function select(ebool cond, euint128 a, euint128 b) internal pure returns (euint128) {
        return ebool.unwrap(cond) ? a : b;
    }

    function and(ebool lhs, ebool rhs) internal pure returns (ebool) {
        return ebool.wrap(ebool.unwrap(lhs) && ebool.unwrap(rhs));
    }

    function decrypt(ebool value) internal pure returns (bool) {
        return ebool.unwrap(value);
    }
}
