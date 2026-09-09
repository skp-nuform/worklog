import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/work")).toBe("/work");
    expect(safeNextPath("/work?status=submitted")).toBe("/work?status=submitted");
    expect(safeNextPath("/work/abc#notes")).toBe("/work/abc#notes");
  });

  it("falls back for empty or missing input", () => {
    expect(safeNextPath(null)).toBe("/sheet");
    expect(safeNextPath(undefined)).toBe("/sheet");
    expect(safeNextPath("")).toBe("/sheet");
    expect(safeNextPath("   ")).toBe("/sheet");
  });

  it("rejects other origins", () => {
    expect(safeNextPath("https://evil.com")).toBe("/sheet");
    expect(safeNextPath("http://evil.com/work")).toBe("/sheet");
    // Protocol-relative: looks like a path, is actually an origin.
    expect(safeNextPath("//evil.com")).toBe("/sheet");
    expect(safeNextPath("//evil.com/work")).toBe("/sheet");
    // Backslash variant that some browsers normalise to //
    expect(safeNextPath("/\\evil.com")).toBe("/sheet");
    expect(safeNextPath("/\\\\evil.com")).toBe("/sheet");
  });

  it("rejects non-path values", () => {
    expect(safeNextPath("work")).toBe("/sheet");
    expect(safeNextPath("javascript:alert(1)")).toBe("/sheet");
    expect(safeNextPath("mailto:a@b.c")).toBe("/sheet");
  });

  it("rejects control characters used for header splitting", () => {
    expect(safeNextPath("/work\nSet-Cookie: x=1")).toBe("/sheet");
    expect(safeNextPath("/work\r\nLocation: https://evil.com")).toBe("/sheet");
  });

  it("does not bounce back into the auth flow", () => {
    expect(safeNextPath("/auth/callback")).toBe("/sheet");
  });

  it("normalises traversal attempts to a same-site path", () => {
    expect(safeNextPath("/work/../../etc")).toBe("/etc");
  });
});
