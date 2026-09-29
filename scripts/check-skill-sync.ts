#!/usr/bin/env bun
/**
 * check-skill-sync.ts
 *
 * Valida que las skills en assets/skills/ estén sincronizadas con manifest.json.
 * Ejecutar en CI para detectar inconsistencias.
 *
 * Uso:
 *   bun run scripts/check-skill-sync.ts
 *   bun run scripts/check-skill-sync.ts --fix    # auto-fix versiones
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const manifest = JSON.parse(
  readFileSync(join(PROJECT_ROOT, "manifest.json"), "utf-8")
);

const skillsDir = join(PROJECT_ROOT, "assets", "skills");
const installedSkills = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((f) =>
      existsSync(join(skillsDir, f, "SKILL.md"))
    )
  : [];

const manifestSkills = (manifest.skills || []).map((s) => s.name);

const fixMode = process.argv.includes("--fix");

// ── Validation ──────────────────────────────────────────────────────────────

const issues: string[] = [];

// Check: all installed skills are in manifest
for (const skill of installedSkills) {
  if (!manifestSkills.includes(skill)) {
    issues.push(`Skill "${skill}" exists in assets/skills/ but not in manifest.json`);
  }
}

// Check: all manifest skills exist
for (const skill of manifestSkills) {
  if (!installedSkills.includes(skill)) {
    issues.push(`Skill "${skill}" in manifest.json but missing from assets/skills/`);
  }
}

// Check: versions match
const packageJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")
);

for (const item of manifest.skills || []) {
  if (item.version !== packageJson.version) {
    issues.push(`Skill "${item.name}" version ${item.version} != package.json ${packageJson.version}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (issues.length === 0) {
  console.log("✅ All skills in sync");
  process.exit(0);
}

console.log(`\n❌ Found ${issues.length} issue(s):\n`);
for (const issue of issues) {
  console.log(`  - ${issue}`);
}

if (fixMode) {
  console.log("\n🔧 Auto-fixing...");

  // Add missing skills to manifest
  for (const skill of installedSkills) {
    if (!manifestSkills.includes(skill)) {
      manifest.skills.push({
        name: skill,
        file: `assets/skills/${skill}/SKILL.md`,
        description: `Skill: ${skill}`,
        version: packageJson.version,
        sha256: null,
      });
      console.log(`  ✅ Added ${skill} to manifest`);
    }
  }

  // Update versions
  for (const item of manifest.skills || []) {
    item.version = packageJson.version;
  }

  writeFileSync(
    join(PROJECT_ROOT, "manifest.json"),
    JSON.stringify(manifest, null, 4) + "\n",
    "utf-8"
  );
  console.log("\n💾 manifest.json updated");
}

process.exit(1);
