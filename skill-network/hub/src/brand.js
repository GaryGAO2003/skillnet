// brand.js — configurable brand name/tagline. The product name is a placeholder
// (SkillNet); technical ids (MCP server name, slugs, cookie name) stay fixed.

export function getBrand(env = process.env) {
  return {
    name: env.BRAND_NAME || 'SkillNet',
    tagline: env.BRAND_TAGLINE || '创作者的 AI 技能市场',
  };
}

// Convenience default computed from the current process env.
export const BRAND = getBrand();
