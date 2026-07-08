// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SkillNFT.sol";
import "../src/CompositionDAG.sol";
import "../src/FeeRouter.sol";

contract SeedScript is Script {
    function run() external {
        address skillNFTAddr      = vm.envAddress("SKILL_NFT_ADDRESS");
        address dagAddr           = vm.envAddress("COMPOSITION_DAG_ADDRESS");
        address feeRouterAddr     = vm.envAddress("FEE_ROUTER_ADDRESS");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        SkillNFT skillNFT   = SkillNFT(skillNFTAddr);
        CompositionDAG dag  = CompositionDAG(dagAddr);
        FeeRouter feeRouter = FeeRouter(payable(feeRouterAddr));

        bytes32 placeholder = keccak256("placeholder");

        vm.startBroadcast(deployerPrivateKey);

        // -------------------------------------------------------------------
        // Mint 5 base skills (no dependencies)
        // -------------------------------------------------------------------

        // 1. JSON Parser — TOOL_ADAPTER, OPEN, 0 ETH
        uint256 jsonParserId = skillNFT.mintSkill(
            "JSON Parser",
            "Parse and transform JSON data structures",
            SkillNFT.SkillType.TOOL_ADAPTER,
            SkillNFT.VisibilityTier.OPEN,
            placeholder,
            "ipfs://QmPlaceholder1",
            0,
            0
        );
        console.log("JSON Parser minted, ID:", jsonParserId);

        // 2. Web Scraper — TOOL_ADAPTER, OPEN, 0 ETH
        uint256 webScraperId = skillNFT.mintSkill(
            "Web Scraper",
            "Extract structured data from web pages",
            SkillNFT.SkillType.TOOL_ADAPTER,
            SkillNFT.VisibilityTier.OPEN,
            placeholder,
            "ipfs://QmPlaceholder2",
            0,
            0
        );
        console.log("Web Scraper minted, ID:", webScraperId);

        // 3. Sentiment Analyzer — PROMPT_WORKFLOW, SHIELDED, 0.001 ETH
        uint256 sentimentId = skillNFT.mintSkill(
            "Sentiment Analyzer",
            "Analyze sentiment and emotional tone in text",
            SkillNFT.SkillType.PROMPT_WORKFLOW,
            SkillNFT.VisibilityTier.SHIELDED,
            placeholder,
            "ipfs://QmPlaceholder3",
            0.001 ether,
            0
        );
        console.log("Sentiment Analyzer minted, ID:", sentimentId);

        // 4. Solidity Auditor — EVAL_PIPELINE, SHIELDED, 0.005 ETH
        uint256 auditorId = skillNFT.mintSkill(
            "Solidity Auditor",
            "Automated smart contract security analysis",
            SkillNFT.SkillType.EVAL_PIPELINE,
            SkillNFT.VisibilityTier.SHIELDED,
            placeholder,
            "ipfs://QmPlaceholder4",
            0.005 ether,
            0
        );
        console.log("Solidity Auditor minted, ID:", auditorId);

        // 5. Medical Diagnosis v1 — AGENT_BEHAVIOR, PRIVATE, 0.01 ETH
        uint256 medicalId = skillNFT.mintSkill(
            "Medical Diagnosis v1",
            "AI-assisted preliminary medical diagnosis",
            SkillNFT.SkillType.AGENT_BEHAVIOR,
            SkillNFT.VisibilityTier.PRIVATE,
            placeholder,
            "ipfs://QmPlaceholder5",
            0.01 ether,
            0
        );
        console.log("Medical Diagnosis v1 minted, ID:", medicalId);

        // -------------------------------------------------------------------
        // Mint 3 composed skills
        // -------------------------------------------------------------------

        // 6. Data Pipeline — COMPOSITE_BUNDLE, OPEN, 0.001 ETH
        //    Deps: JSON Parser (60%) + Web Scraper (40%)
        uint256 dataPipelineId = skillNFT.mintSkill(
            "Data Pipeline",
            "End-to-end data collection and transformation pipeline",
            SkillNFT.SkillType.COMPOSITE_BUNDLE,
            SkillNFT.VisibilityTier.OPEN,
            placeholder,
            "ipfs://QmPlaceholder6",
            0.001 ether,
            0
        );
        console.log("Data Pipeline minted, ID:", dataPipelineId);

        uint256[] memory dp_parents = new uint256[](2);
        dp_parents[0] = jsonParserId;
        dp_parents[1] = webScraperId;
        uint256[] memory dp_weights = new uint256[](2);
        dp_weights[0] = 60;
        dp_weights[1] = 40;
        dag.compose(dataPipelineId, dp_parents, dp_weights);
        console.log("Data Pipeline composed");

        // 7. DeFi Research Agent — COMPOSITE_BUNDLE, SHIELDED, 0.008 ETH
        //    Deps: Data Pipeline (40%) + Sentiment Analyzer (30%) + Solidity Auditor (30%)
        uint256 defiAgentId = skillNFT.mintSkill(
            "DeFi Research Agent",
            "Comprehensive DeFi protocol analysis and research",
            SkillNFT.SkillType.COMPOSITE_BUNDLE,
            SkillNFT.VisibilityTier.SHIELDED,
            placeholder,
            "ipfs://QmPlaceholder7",
            0.008 ether,
            0
        );
        console.log("DeFi Research Agent minted, ID:", defiAgentId);

        uint256[] memory defi_parents = new uint256[](3);
        defi_parents[0] = dataPipelineId;
        defi_parents[1] = sentimentId;
        defi_parents[2] = auditorId;
        uint256[] memory defi_weights = new uint256[](3);
        defi_weights[0] = 40;
        defi_weights[1] = 30;
        defi_weights[2] = 30;
        dag.compose(defiAgentId, defi_parents, defi_weights);
        console.log("DeFi Research Agent composed");

        // 8. Full Audit Suite — COMPOSITE_BUNDLE, SHIELDED, 0.015 ETH
        //    Deps: DeFi Research Agent (70%) + Solidity Auditor (30%)
        uint256 fullAuditId = skillNFT.mintSkill(
            "Full Audit Suite",
            "Complete smart contract and DeFi protocol audit suite",
            SkillNFT.SkillType.COMPOSITE_BUNDLE,
            SkillNFT.VisibilityTier.SHIELDED,
            placeholder,
            "ipfs://QmPlaceholder8",
            0.015 ether,
            0
        );
        console.log("Full Audit Suite minted, ID:", fullAuditId);

        uint256[] memory audit_parents = new uint256[](2);
        audit_parents[0] = defiAgentId;
        audit_parents[1] = auditorId;
        uint256[] memory audit_weights = new uint256[](2);
        audit_weights[0] = 70;
        audit_weights[1] = 30;
        dag.compose(fullAuditId, audit_parents, audit_weights);
        console.log("Full Audit Suite composed");

        // -------------------------------------------------------------------
        // Simulate paid calls to Full Audit Suite
        // (SEED_CALLS env overrides; default 10 suits a funded local node,
        //  use a smaller value on testnets where the deployer holds less ETH)
        // -------------------------------------------------------------------
        uint256 numCalls = vm.envOr("SEED_CALLS", uint256(10));
        console.log("\nSimulating calls to Full Audit Suite:", numCalls);
        for (uint256 i = 0; i < numCalls; i++) {
            feeRouter.payForCall{value: 0.015 ether}(fullAuditId);
        }
        console.log("Calls simulated successfully:", numCalls);

        vm.stopBroadcast();

        console.log("\n=== Seed Summary ===");
        console.log("Total skills minted: 8");
        console.log("Full Audit Suite ID:", fullAuditId);
        console.log("Deployer FeeRouter balance:", feeRouter.getBalance(msg.sender));
    }
}
