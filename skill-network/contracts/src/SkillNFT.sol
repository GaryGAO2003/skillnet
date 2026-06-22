// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SkillNFT
/// @notice ERC-721 contract for minting AI skills as NFTs with visibility tiers
contract SkillNFT is ERC721, Ownable {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Visibility tier — lower index = more public
    /// OPEN(0) = fully public, SHIELDED(1) = semi-private, PRIVATE(2) = fully private
    enum VisibilityTier { OPEN, SHIELDED, PRIVATE }

    enum SkillType {
        PROMPT_WORKFLOW,
        TOOL_ADAPTER,
        AGENT_BEHAVIOR,
        EVAL_PIPELINE,
        LORA_ADAPTER,
        DATASET,
        COMPOSITE_BUNDLE
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct SkillMetadata {
        string name;
        string description;
        SkillType skillType;
        VisibilityTier tier;
        bytes32 contentHash;    // SHA-256 of off-chain skill content
        string schemaURI;       // IPFS URI for MCP-compatible schema
        uint256 pricePerCall;   // in wei
        address creator;
        uint256 version;
        uint256 previousVersion; // 0 if original
        uint256 totalCalls;
        uint256 totalRevenue;
        uint256 createdAt;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    mapping(uint256 => SkillMetadata) private _skills;
    uint256 private _nextTokenId = 1;
    address public feeRouter;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event SkillMinted(uint256 indexed tokenId, address indexed creator, VisibilityTier tier);
    event TierUpgraded(uint256 indexed tokenId, VisibilityTier from, VisibilityTier to);
    event SkillCalled(uint256 indexed tokenId, uint256 totalCalls);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyFeeRouter() {
        require(msg.sender == feeRouter, "SkillNFT: caller is not FeeRouter");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() ERC721("SkillNFT", "SKILL") Ownable(msg.sender) {}

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @notice Set the authorized FeeRouter address (called after FeeRouter deploy)
    function setFeeRouter(address _feeRouter) external onlyOwner {
        require(_feeRouter != address(0), "SkillNFT: zero address");
        feeRouter = _feeRouter;
    }

    // -------------------------------------------------------------------------
    // Write functions
    // -------------------------------------------------------------------------

    /// @notice Mint a new skill NFT
    /// @param name Skill name
    /// @param description Skill description
    /// @param skillType Type of skill
    /// @param tier Visibility tier
    /// @param contentHash SHA-256 hash of skill content
    /// @param schemaURI IPFS URI for input/output schema
    /// @param pricePerCall Fee in wei for each call
    /// @param previousVersion Token ID of previous version (0 if original)
    /// @return tokenId The minted token ID
    function mintSkill(
        string calldata name,
        string calldata description,
        SkillType skillType,
        VisibilityTier tier,
        bytes32 contentHash,
        string calldata schemaURI,
        uint256 pricePerCall,
        uint256 previousVersion
    ) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        _skills[tokenId] = SkillMetadata({
            name: name,
            description: description,
            skillType: skillType,
            tier: tier,
            contentHash: contentHash,
            schemaURI: schemaURI,
            pricePerCall: pricePerCall,
            creator: msg.sender,
            version: tokenId,
            previousVersion: previousVersion,
            totalCalls: 0,
            totalRevenue: 0,
            createdAt: block.timestamp
        });

        emit SkillMinted(tokenId, msg.sender, tier);
    }

    /// @notice Upgrade a skill's visibility tier to a more public tier (one-way)
    /// @dev Tier can only move toward OPEN (lower index). PRIVATE→SHIELDED→OPEN
    /// @param tokenId The skill token ID
    /// @param newTier The new (more public) tier
    function upgradeTier(uint256 tokenId, VisibilityTier newTier) external {
        require(ownerOf(tokenId) == msg.sender, "SkillNFT: not token owner");
        VisibilityTier currentTier = _skills[tokenId].tier;
        require(uint8(newTier) < uint8(currentTier), "SkillNFT: can only upgrade to more public tier");

        VisibilityTier oldTier = currentTier;
        _skills[tokenId].tier = newTier;
        emit TierUpgraded(tokenId, oldTier, newTier);
    }

    /// @notice Record a call to a skill — only callable by FeeRouter
    /// @param tokenId The skill token ID
    /// @param value ETH value paid for the call
    function recordCall(uint256 tokenId, uint256 value) external onlyFeeRouter {
        _skills[tokenId].totalCalls += 1;
        _skills[tokenId].totalRevenue += value;
        emit SkillCalled(tokenId, _skills[tokenId].totalCalls);
    }

    // -------------------------------------------------------------------------
    // Read functions
    // -------------------------------------------------------------------------

    /// @notice Get all metadata for a skill
    function getSkill(uint256 tokenId) external view returns (SkillMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "SkillNFT: token does not exist");
        return _skills[tokenId];
    }

    /// @notice Total number of skills minted
    function totalSkills() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
