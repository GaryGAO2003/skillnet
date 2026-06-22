// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SkillNFT.sol";
import "../src/CompositionDAG.sol";
import "../src/FeeRouter.sol";

contract DeployScript is Script {
    function run() external {
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy SkillNFT
        SkillNFT skillNFT = new SkillNFT();
        console.log("SkillNFT deployed at:", address(skillNFT));

        // 2. Deploy CompositionDAG
        CompositionDAG dag = new CompositionDAG(address(skillNFT));
        console.log("CompositionDAG deployed at:", address(dag));

        // 3. Deploy FeeRouter
        FeeRouter feeRouter = new FeeRouter(address(skillNFT), address(dag), treasury);
        console.log("FeeRouter deployed at:", address(feeRouter));

        // 4. Authorize FeeRouter in SkillNFT
        skillNFT.setFeeRouter(address(feeRouter));
        console.log("FeeRouter authorized in SkillNFT");

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("SKILL_NFT_ADDRESS=%s", address(skillNFT));
        console.log("COMPOSITION_DAG_ADDRESS=%s", address(dag));
        console.log("FEE_ROUTER_ADDRESS=%s", address(feeRouter));
    }
}
