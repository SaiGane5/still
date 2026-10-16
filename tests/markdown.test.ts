import { describe, expect, it } from "vitest";
import { continueList, prefixLines, wrapSelection } from "@/lib/markdown";

describe("markdown helpers", () => {
  it("wraps and unwraps a selection", () => {
    const e = wrapSelection("say hello now", 4, 9, "**");
    expect(e.text).toBe("**hello**");
    const un = wrapSelection("say **hello** now", 6, 11, "**");
    expect(un).toMatchObject({ start: 4, end: 13, text: "hello" });
  });
  it("prefixes and unprefixes lines", () => {
    expect(prefixLines("a\nb", 0, 3, "- ").text).toBe("- a\n- b");
    expect(prefixLines("- a\n- b", 0, 7, "- ").text).toBe("a\nb");
  });
  it("continues lists and ends them on an empty item", () => {
    expect(continueList("- one", 5)?.text).toBe("\n- ");
    expect(continueList("1. one", 6)?.text).toBe("\n2. ");
    expect(continueList("- ", 2)).toMatchObject({ start: 0, end: 2, text: "" });
    expect(continueList("plain", 5)).toBeNull();
  });
});
