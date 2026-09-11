import { describe, expect, it } from "vitest";
import { isNuformEmail, formatNuformEmailError } from "./domain";

describe("isNuformEmail", () => {
  it("accepts valid @nuformsocial.com emails", () => {
    expect(isNuformEmail("abhishek@nuformsocial.com")).toBe(true);
    expect(isNuformEmail("sushant@nuformsocial.com")).toBe(true);
    expect(isNuformEmail("first.last@nuformsocial.com")).toBe(true);
  });

  it("handles case insensitivity", () => {
    expect(isNuformEmail("Abhishek@NuformSocial.com")).toBe(true);
    expect(isNuformEmail("USER@NUFORMSOCIAL.COM")).toBe(true);
  });

  it("handles trailing/leading whitespace", () => {
    expect(isNuformEmail("  abhishek@nuformsocial.com  ")).toBe(true);
  });

  it("rejects non-nuform domains", () => {
    expect(isNuformEmail("abhishek@gmail.com")).toBe(false);
    expect(isNuformEmail("user@yahoo.com")).toBe(false);
    expect(isNuformEmail("user@nuform.com")).toBe(false);
    expect(isNuformEmail("user@fake-nuformsocial.com")).toBe(false);
  });

  it("rejects empty, null, or bare domain", () => {
    expect(isNuformEmail("")).toBe(false);
    expect(isNuformEmail(null)).toBe(false);
    expect(isNuformEmail(undefined)).toBe(false);
    expect(isNuformEmail("@nuformsocial.com")).toBe(false);
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
