/**
 * wave4LiveContinue.js — Steps 2–5 after oracle already has live spot.
 *
 *   npx hardhat run scripts/wave4LiveContinue.js --network arbitrumSepolia
 */
process.env.SKIP_INITIAL_SUBMIT = "1";
require("./wave4LiveE2E.js");
