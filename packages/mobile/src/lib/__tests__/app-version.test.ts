import { versionLabel } from "../app-version";

test("names the update by its commit", () => {
  expect(versionLabel("1.0", "202611271316", { enabled: true, embedded: false, commit: "15bb9e4da7467277e50eb6083cc3ed4f7234d839" })).toBe(
    "Version 1.0 (202611271316), update 15bb9e4",
  );
});

test("says so when the build runs the bundle it shipped with", () => {
  expect(versionLabel("1.0", "202611271316", { enabled: true, embedded: true })).toBe("Version 1.0 (202611271316), no update");
});

test("an update without a commit falls back to its id", () => {
  expect(versionLabel("1.0", "7", { enabled: true, embedded: false, updateId: "0a1b2c3d-0000-0000-0000-000000000000" })).toBe("Version 1.0 (7), update 0a1b2c3d");
});

test("a build without updates shows the build alone", () => {
  expect(versionLabel("1.0", undefined, { enabled: false, embedded: true })).toBe("Version 1.0");
});
