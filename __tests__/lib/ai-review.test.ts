import { describe, it, expect } from "vitest";

import {
  assessTechnicalQuality,
  generateCandidates,
  REVIEW_MODALITIES,
  TECHNICAL_CHECKS,
  DEFAULT_TECHNICAL_CHECKS,
} from "@/lib/ai-review";

describe("AI Review Assistant", () => {
  describe("REVIEW_MODALITIES", () => {
    it("should include all required modalities", () => {
      expect(REVIEW_MODALITIES).toContain("X-Ray");
      expect(REVIEW_MODALITIES).toContain("CT");
      expect(REVIEW_MODALITIES).toContain("MRI");
      expect(REVIEW_MODALITIES).toContain("Ultrasound");
      expect(REVIEW_MODALITIES).toContain("Mammography");
      expect(REVIEW_MODALITIES).toContain("DEXA");
      expect(REVIEW_MODALITIES).toContain("Dental");
      expect(REVIEW_MODALITIES).toContain("Nuclear Medicine");
    });
  });

  describe("TECHNICAL_CHECKS", () => {
    it("should have checks for all major modalities", () => {
      expect(TECHNICAL_CHECKS["X-Ray"]).toBeTruthy();
      expect(TECHNICAL_CHECKS.CT).toBeTruthy();
      expect(TECHNICAL_CHECKS.MRI).toBeTruthy();
      expect(TECHNICAL_CHECKS.Ultrasound).toBeTruthy();
      expect(TECHNICAL_CHECKS.Mammography).toBeTruthy();
    });

    it("each modality should have weighted checks", () => {
      for (const [modality, checks] of Object.entries(TECHNICAL_CHECKS)) {
        expect(checks.length).toBeGreaterThan(0);
        const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
        expect(totalWeight).toBe(100);
      }
    });
  });

  describe("assessTechnicalQuality", () => {
    it("should return checks and overall score for X-Ray", () => {
      const result = assessTechnicalQuality("X-Ray");
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });

    it("should use default checks for unknown modality", () => {
      const result = assessTechnicalQuality("Unknown");
      expect(result.checks.length).toBe(DEFAULT_TECHNICAL_CHECKS.length);
    });

    it("should return pass/fail for each check", () => {
      const result = assessTechnicalQuality("CT");
      for (const check of result.checks) {
        expect(typeof check.passed).toBe("boolean");
        expect(check.label).toBeTruthy();
      }
    });
  });

  describe("generateCandidates", () => {
    it("should generate candidates for X-Ray", () => {
      const candidates = generateCandidates({ modality: "X-Ray" });
      expect(candidates.length).toBeGreaterThanOrEqual(2);
    });

    it("should generate candidates with required fields", () => {
      const candidates = generateCandidates({ modality: "CT", bodyPart: "Brain" });
      for (const candidate of candidates) {
        expect(candidate.category).toBeTruthy();
        expect(candidate.region).toBeTruthy();
        expect(candidate.description).toBeTruthy();
        expect(candidate.confidence).toBeGreaterThanOrEqual(0);
        expect(candidate.confidence).toBeLessThanOrEqual(100);
        expect(Array.isArray(candidate.suggestedDifferential)).toBe(true);
        expect(Array.isArray(candidate.literatureRefs)).toBe(true);
        expect(Array.isArray(candidate.similarCaseIds)).toBe(true);
      }
    });

    it("should include a critical candidate for high confidence findings", () => {
      // Run multiple times to check for critical candidates (random ~16% per run; 30 runs = ~99.6% chance)
      let hasCritical = false;
      for (let i = 0; i < 30; i++) {
        const candidates = generateCandidates({ modality: "CT" });
        if (candidates.some((c) => c.category === "critical")) {
          hasCritical = true;
          break;
        }
      }
      expect(hasCritical).toBe(true);
    });

    it("should always include a technical quality candidate", () => {
      const candidates = generateCandidates({ modality: "MRI" });
      const technicalCandidate = candidates.find((c) => c.category === "technical");
      expect(technicalCandidate).toBeTruthy();
      expect(technicalCandidate?.region).toBe("Image quality");
    });

    it("should respect body part hint when provided", () => {
      const candidates = generateCandidates({ modality: "CT", bodyPart: "Abdomen" });
      const findingCandidate = candidates.find((c) => c.category === "finding" || c.category === "critical");
      expect(findingCandidate?.region.toLowerCase()).toContain("abdomen");
    });

    it("should not make diagnoses - only suggest candidates", () => {
      const candidates = generateCandidates({ modality: "X-Ray" });
      for (const candidate of candidates) {
        // Should not contain definitive diagnostic language
        expect(candidate.description.toLowerCase()).not.toMatch(/^(diagnosis|diagnosed|confirmed)/);
        // Should indicate this is advisory
        expect(candidate.description).toMatch(/(suggest|verify|confirm|candidate|check)/i);
      }
    });
  });

  describe("Decision support boundaries", () => {
    it("should never auto-accept findings", () => {
      const candidates = generateCandidates({ modality: "Mammography" });
      // All candidates should have moderate confidence (not 100%)
      const highConfidence = candidates.filter((c) => c.confidence >= 95);
      expect(highConfidence.length).toBe(0);
    });

    it("should provide differentials, not diagnoses", () => {
      const candidates = generateCandidates({ modality: "Ultrasound" });
      const findingCandidate = candidates.find((c) => c.category === "finding");
      if (findingCandidate) {
        expect(findingCandidate.suggestedDifferential.length).toBeGreaterThan(0);
        // Differentials should be multiple options, not a single diagnosis
        expect(findingCandidate.suggestedDifferential.some((d) => d.includes(","))).toBe(true);
      }
    });
  });
});
