// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FHEMock
 * @notice Stand-in for @fhenixprotocol/contracts/FHE.sol for local testing.
 *
 * On Fhenix testnets (Helium / Arbitrum Sepolia with CoFHE):
 *   - Replace this import with: import "@fhenixprotocol/contracts/FHE.sol";
 *   - Replace `uint256` with `euint256` and `inEuint256` for the real types.
 *   - Remove this file entirely.
 *
 * Locally, euint256 is just a uint256 alias so Hardhat can compile and test
 * all access-control, staleness, and aggregation logic without an FHE node.
 * This lets you write and test 100% of the business logic before deploying
 * to a Fhenix testnet.
 */

// Type alias — replaced with real FHE type on Fhenix
type euint256 is uint256;

library FHEMock {

    /// @notice Wrap a plaintext uint256 as a mock euint256.
    function asEuint256(uint256 value) internal pure returns (euint256) {
        return euint256.wrap(value);
    }

    /// @notice Return a zero-valued mock euint256 (uninitialised feed price).
    function zero() internal pure returns (euint256) {
        return euint256.wrap(0);
    }

    /// @notice Mock FHE greater-than. Returns true if a > b.
    ///         On Fhenix: replace with FHE.gt(a, b) which returns ebool.
    function gt(euint256 a, euint256 b) internal pure returns (bool) {
        return euint256.unwrap(a) > euint256.unwrap(b);
    }

    /// @notice Mock FHE select (ternary). Returns a if cond, else b.
    ///         On Fhenix: replace with FHE.select(cond, a, b).
    function select(bool cond, euint256 a, euint256 b) internal pure returns (euint256) {
        return cond ? a : b;
    }

    /**
     * @notice Compute the encrypted median of an array of euint256 values.
     *
     * Algorithm (works in FHE without decrypting):
     *   For each price p_i, count how many other prices it is >= to.
     *   The price with count == floor(n/2) is the median.
     *
     *   Locally: unwrap and sort normally for correctness testing.
     *   On Fhenix: replace inner comparisons with FHE.gt and FHE.select.
     *
     * @param prices  Array of encrypted prices from all feeders this round.
     * @return        The encrypted median price.
     */
    function encryptedMedian(euint256[] memory prices) internal pure returns (euint256) {
        uint256 n = prices.length;
        if (n == 1) return prices[0];

        // Unwrap for local sorting (replace with FHE ops on Fhenix)
        uint256[] memory vals = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            vals[i] = euint256.unwrap(prices[i]);
        }

        // Simple insertion sort — O(n²), fine for n ≤ 9 feeders
        for (uint256 i = 1; i < n; i++) {
            uint256 key = vals[i];
            int256 j = int256(i) - 1;
            while (j >= 0 && vals[uint256(j)] > key) {
                vals[uint256(j + 1)] = vals[uint256(j)];
                j--;
            }
            vals[uint256(j + 1)] = key;
        }

        return euint256.wrap(vals[n / 2]);
    }

    /**
     * @notice Decrypt a mock euint256 for testing/logging.
     *         NEVER call this in production — on Fhenix use the permit system
     *         and CoFHE SDK to decrypt client-side.
     */
    function unsafeReveal(euint256 enc) internal pure returns (uint256) {
        return euint256.unwrap(enc);
    }
}
