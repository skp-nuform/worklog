import { describe, expect, it } from "vitest";
import {
  isNuformEmail,
  formatNuformEmailError,
  validateAndNormalizeEmail,
} from "./domain";

describe("validateAndNormalizeEmail", () => {
  it("accepts valid @nuformsocial.com emails", () => {
    const res = validateAndNormalizeEmail("abhishek@nuformsocial.com");
    expect(res.valid).toBe(true);
    expect(res.normalizedEmail).toBe("abhishek@nuformsocial.com");
    expect(res.corrected).toBe(false);
  });

  it("accepts username-only and auto-completes domain", () => {
    const res1 = validateAndNormalizeEmail("asush");
    expect(res1.valid).toBe(true);
    expect(res1.normalizedEmail).toBe("asush@nuformsocial.com");
    expect(res1.corrected).toBe(true);

    const res2 = validateAndNormalizeEmail("sushant.kumar");
    expect(res2.valid).toBe(true);
    expect(res2.normalizedEmail).toBe("sushant.kumar@nuformsocial.com");
  });

  it("forgives and auto-corrects common typos like nurformsocial.com", () => {
    const res = validateAndNormalizeEmail("asush@nurformsocial.com");
    expect(res.valid).toBe(true);
    expect(res.normalizedEmail).toBe("asush@nuformsocial.com");
    expect(res.corrected).toBe(true);

    const res2 = validateAndNormalizeEmail("test@nuformssocial.com");
    expect(res2.valid).toBe(true);
    expect(res2.normalizedEmail).toBe("test@nuformsocial.com");
  });

  it("handles case insensitivity and whitespace", () => {
    const res = validateAndNormalizeEmail("  Abhishek@NuformSocial.com  ");
    expect(res.valid).toBe(true);
    expect(res.normalizedEmail).toBe("abhishek@nuformsocial.com");
  });

  it("rejects non-nuform domains", () => {
    const res1 = validateAndNormalizeEmail("abhishek@gmail.com");
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain("Only @nuformsocial.com");

    const res2 = validateAndNormalizeEmail("user@yahoo.com");
    expect(res2.valid).toBe(false);
  });

  it("rejects empty or invalid inputs", () => {
    expect(validateAndNormalizeEmail("").valid).toBe(false);
    expect(validateAndNormalizeEmail(null).valid).toBe(false);
    expect(validateAndNormalizeEmail("@nuformsocial.com").valid).toBe(false);
  });
});

describe("isNuformEmail", () => {
  it("accepts valid and auto-correctable formats", () => {
    expect(isNuformEmail("abhishek@nuformsocial.com")).toBe(true);
    expect(isNuformEmail("asush")).toBe(true);
    expect(isNuformEmail("asush@nurformsocial.com")).toBe(true);
  });

  it("rejects external domains", () => {
    expect(isNuformEmail("user@gmail.com")).toBe(false);
  });
});

describe("formatNuformEmailError", () => {
  it("returns domain restriction error for non-nuform emails", () => {
    expect(formatNuformEmailError("test@gmail.com")).toContain("Only @nuformsocial.com");
  });

  it("returns empty string for valid email", () => {
    expect(formatNuformEmailError("test@nuformsocial.com")).toBe("");
  });
});
