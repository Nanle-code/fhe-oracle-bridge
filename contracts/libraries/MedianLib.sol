// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../mocks/FHECompat.sol";

library MedianLib {
    function encryptedMedian(euint128[] memory prices) internal pure returns (euint128) {
        uint256 n = prices.length;
        if (n == 1) return prices[0];

        // Encrypted compare+swap sort using FHE.gt + FHE.select.
        // O(n^2) comparisons, acceptable for small feeder sets (n ≤ 5).
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                ebool swap = FHE.gt(prices[i], prices[j]); // true if prices[i] > prices[j]
                euint128 hi = FHE.select(swap, prices[i], prices[j]);
                euint128 lo = FHE.select(swap, prices[j], prices[i]);
                prices[i] = lo;
                prices[j] = hi;
            }
        }

        return prices[n / 2];
    }
}
