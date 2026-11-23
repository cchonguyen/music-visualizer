import { describe, expect, it } from "vitest";
import { parseLink, type AudioLink, type Morph } from "../format";
import {
  LINK_RECIPES,
  buildRecipeLink,
  matchingRecipeId,
  summarizeAudioLink,
} from "../linkRecipes";

describe("linkRecipes", () => {
  it("exposes 7 curated recipes whose baseLinks parse with 0 warnings", () => {
    expect(LINK_RECIPES).toHaveLength(7);
    expect(LINK_RECIPES.map((r) => r.id)).toEqual([
      "kickPunch",
      "bassSwell",
      "dropSurge",
      "flipOnDrop",
      "flipOnBeat",
      "phraseDrift",
      "breakdownBloom",
    ]);

    for (const recipe of LINK_RECIPES) {
      const warnings: string[] = [];
      const parsed = parseLink(recipe.baseLink, `recipe.${recipe.id}`, warnings);
      expect(warnings).toEqual([]);
      expect(parsed).toEqual(recipe.baseLink);
    }
  });

  describe("buildRecipeLink", () => {
    it("scales amount down for sensitive parameters", () => {
      expect(buildRecipeLink("dropSurge", { name: "zoom" }).amount).toBe(0.13);
      expect(buildRecipeLink("dropSurge", { name: "rotate" }).amount).toBe(0.15);
      expect(buildRecipeLink("dropSurge", { name: "decay" }).amount).toBe(0.13);
      expect(buildRecipeLink("dropSurge", { name: "fade" }).amount).toBe(0.13);
      expect(buildRecipeLink("dropSurge", { name: "driftX" }).amount).toBe(0.18);
      expect(buildRecipeLink("dropSurge", { name: "driftY" }).amount).toBe(0.18);
      expect(buildRecipeLink("dropSurge", { name: "centreX" }).amount).toBe(0.18);
      expect(buildRecipeLink("dropSurge", { name: "centreY" }).amount).toBe(0.18);
    });

    it("caps scaling at 0.45 for intense parameters", () => {
      // dropSurge base amount is 0.5 -> 0.5 * 0.45 = 0.225 -> rounded to 0.23
      expect(buildRecipeLink("dropSurge", { name: "warp", intense: true }).amount).toBe(0.23);
      // zoom (0.25) is already below 0.45, so intense keeps 0.25
      expect(buildRecipeLink("dropSurge", { name: "zoom", intense: true }).amount).toBe(0.13);
    });

    it("uses 1.0 scale for standard non-intense parameters and falls back to LINK_RECIPES[0]", () => {
      const warpLink = buildRecipeLink("kickPunch", { name: "warp" });
      expect(warpLink).toEqual(LINK_RECIPES[0]!.baseLink);

      const sizeLink = buildRecipeLink("phraseDrift", { name: "size" });
      expect(sizeLink.amount).toBe(0.45);
      expect(sizeLink.source).toBe("phrase32");

      const fallbackLink = buildRecipeLink("nonexistentRecipe", { name: "size" });
      expect(fallbackLink).toEqual(LINK_RECIPES[0]!.baseLink);
    });
  });

  describe("summarizeAudioLink", () => {
    it("returns empty string when neither link nor morph is present", () => {
      expect(summarizeAudioLink()).toBe("");
      expect(summarizeAudioLink(undefined, undefined)).toBe("");
    });

    it("formats morph-only summary", () => {
      const morph: Morph = { to: 0.75, rate: 0.2 };
      expect(summarizeAudioLink(undefined, morph)).toBe("morph → 0.75");
    });

    it("formats link-only summaries including mode and non-linear curve tags", () => {
      expect(summarizeAudioLink(LINK_RECIPES[0]!.baseLink)).toBe("kickEnv +35% punch");
      expect(summarizeAudioLink(LINK_RECIPES[1]!.baseLink)).toBe("bass +35% swell");
      expect(summarizeAudioLink(LINK_RECIPES[2]!.baseLink)).toBe("drop +50% gate");
      expect(summarizeAudioLink(LINK_RECIPES[3]!.baseLink)).toBe("energy +40% ⇄Drop");
      expect(summarizeAudioLink(LINK_RECIPES[4]!.baseLink)).toBe("bass +32% ⇄Beat punch");
      expect(summarizeAudioLink(LINK_RECIPES[5]!.baseLink)).toBe("phrase32 +45% ±");

      const sectionLink: AudioLink = {
        source: "section",
        amount: -0.25,
        smooth: 0.2,
        mode: "flipOnSection",
        curve: "linear",
      };
      expect(summarizeAudioLink(sectionLink)).toBe("section -25% ⇄Sec");
    });

    it("combines link and morph summaries", () => {
      const morph: Morph = { to: 1.5, rate: 0.1 };
      expect(summarizeAudioLink(LINK_RECIPES[0]!.baseLink, morph)).toBe(
        "kickEnv +35% punch · morph → 1.50",
      );
    });
  });

  describe("matchingRecipeId", () => {
    it("returns null for undefined or unmatched custom links", () => {
      expect(matchingRecipeId(undefined)).toBeNull();
      expect(
        matchingRecipeId({ source: "mid", amount: 0.4, smooth: 0.2, mode: "add", curve: "linear" }),
      ).toBeNull();
      expect(
        matchingRecipeId({ source: "kickEnv", amount: 0.35, smooth: 0.1, mode: "bipolar", curve: "punch" }),
      ).toBeNull();
    });

    it("matches scaled recipe links and links with omitted default mode/curve", () => {
      for (const recipe of LINK_RECIPES) {
        const scaled = buildRecipeLink(recipe.id, { name: "zoom", intense: true });
        expect(matchingRecipeId(scaled)).toBe(recipe.id);
      }

      // Default mode='add' and curve='linear' should match flipOnDrop/phraseDrift? No, flipOnDrop has mode='flipOnDrop'.
      // Check matching when curve is omitted on a recipe whose baseLink uses curve='linear'
      expect(
        matchingRecipeId({ source: "energy", amount: 0.2, smooth: 0.4, mode: "flipOnDrop" }),
      ).toBe("flipOnDrop");
      expect(
        matchingRecipeId({ source: "phrase32", amount: 0.1, smooth: 0.5, mode: "bipolar" }),
      ).toBe("phraseDrift");
    });
  });
});
