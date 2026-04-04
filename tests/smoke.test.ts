import { describe, it, expect } from "vitest";
import { toolSuccess, toolError } from "../src/types.js";

describe("types", () => {
  it("creates success response", () => {
    const result = toolSuccess({ value: 42 });
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it("creates error response", () => {
    const result = toolError("session", "no browser");
    expect(result.success).toBe(false);
    expect(result.error.category).toBe("session");
    expect(result.error.message).toBe("no browser");
  });
});
