import { describe, expect, it } from "vitest";
import {
  describeSupabaseUrlProblem,
  normalizeSupabaseUrl,
} from "../src/lib/supabase/url";

const PROJECT = "https://abcdefghijklmnop.supabase.co";

describe("normalizeSupabaseUrl", () => {
  it("leaves a correct project URL alone", () => {
    expect(normalizeSupabaseUrl(PROJECT)).toBe(PROJECT);
  });

  it("strips trailing slashes", () => {
    expect(normalizeSupabaseUrl(`${PROJECT}/`)).toBe(PROJECT);
    expect(normalizeSupabaseUrl(`${PROJECT}///`)).toBe(PROJECT);
  });

  it("strips a service path pasted from the dashboard", () => {
    // The mistake that produced "Invalid path specified in request URL".
    expect(normalizeSupabaseUrl(`${PROJECT}/rest/v1/`)).toBe(PROJECT);
    expect(normalizeSupabaseUrl(`${PROJECT}/auth/v1`)).toBe(PROJECT);
    expect(normalizeSupabaseUrl(`${PROJECT}/storage/v1`)).toBe(PROJECT);
    expect(normalizeSupabaseUrl(`${PROJECT}/rest/v1/rest/v1`)).toBe(PROJECT);
  });

  it("survives stray quotes and whitespace from copy-paste", () => {
    expect(normalizeSupabaseUrl(`  "${PROJECT}/rest/v1"  `)).toBe(PROJECT);
    expect(normalizeSupabaseUrl(`'${PROJECT}'`)).toBe(PROJECT);
  });
});

describe("describeSupabaseUrlProblem", () => {
  it("accepts a clean project URL", () => {
    expect(describeSupabaseUrlProblem(PROJECT)).toBeNull();
  });

  it("rejects an empty value", () => {
    expect(describeSupabaseUrlProblem("")).toMatch(/empty/i);
  });

  it("rejects something that is not a URL", () => {
    expect(describeSupabaseUrlProblem("abcdefghijklmnop")).toMatch(/not a valid URL/i);
  });

  it("names the dashboard mix-up explicitly", () => {
    expect(
      describeSupabaseUrlProblem("https://supabase.com/dashboard/project/abc"),
    ).toMatch(/dashboard/i);
  });

  it("rejects a leftover path", () => {
    expect(describeSupabaseUrlProblem(`${PROJECT}/rest/v1/characters`)).toMatch(
      /no path/i,
    );
  });
});
