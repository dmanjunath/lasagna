import { themes } from "@lasagna/design";
import { getTheme } from "@lasagna/design";
import { type, weight, radius, palettes, themedStyles, font } from "@/theme";
import { resolve } from "../resolve";
import { EMBEDDED_FACES, RUNTIME_FACES } from "../fonts";
import { setDesign } from "../store";

afterEach(() => setDesign("noodle"));

test("every face a theme names is embedded or loaded at boot", () => {
  for (const theme of themes) {
    for (const role of Object.values(theme.font)) {
      for (const face of Object.values(role.faces)) {
        expect(EMBEDDED_FACES.has(face!.name) || face!.name in RUNTIME_FACES).toBe(true);
      }
    }
  }
});

test("the @/theme adapter follows a switch, keeping object identity", () => {
  setDesign("noodle");
  const headline = type.headline;
  expect(type.title.fontFamily).toBe("Baloo2-ExtraBold");
  expect(radius.lg).toBe(24);
  expect(palettes.light.canvas).toBe("#F6EFE3");

  setDesign("classic");
  expect(type.headline).toBe(headline);
  expect(type.title.fontFamily).toBe("InstrumentSans-Bold");
  expect(type.headline.fontFamily).toBe("PlusJakartaSans-SemiBold");
  expect(type.display).toMatchObject({ fontFamily: "Figtree-ExtraBold", fontSize: 34, lineHeight: 40, letterSpacing: -0.8 });
  expect(font.heading).toBe("InstrumentSans-Bold");
  expect(radius.lg).toBe(16);
  expect(palettes.dark.canvas).toBe("rgb(13, 17, 23)");
});

test("a switch survives styles React Native froze in development", () => {
  setDesign("noodle");
  // type.subhead and weight.bold passed to a component as is get frozen in development.
  Object.freeze(type.subhead);
  Object.freeze(weight.bold);
  expect(() => setDesign("classic")).not.toThrow();
  const classic = resolve(getTheme("classic"), "light");
  expect(type.subhead).toEqual(classic.type.subhead);
  expect(weight.bold).toEqual(classic.weight.bold);
});

test("themedStyles rebuilds after a switch", () => {
  setDesign("noodle");
  const styles = themedStyles(() => ({ title: { ...type.title, flexShrink: 1 } }));
  expect(styles.title.fontFamily).toBe("Baloo2-ExtraBold");
  setDesign("classic");
  expect(styles.title.fontFamily).toBe("InstrumentSans-Bold");
  expect(styles.title.flexShrink).toBe(1);
});
